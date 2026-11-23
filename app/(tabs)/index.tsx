import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View,
  Text,
  ScrollView,
  Pressable,
  StyleSheet,
  Dimensions,
  Image,
  Share,
  TextInput,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  useWindowDimensions,
} from 'react-native';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { WORDMARK_TEXT, wordmarkFontSize } from '../../constants/wordmark';
import { PlayerAvatar } from '../../components/PlayerAvatar';
import { listFriends, Friend } from '../../services/friends';
import { useInviteStore } from '../../store/inviteStore';
import { useGameStore } from '../../store/gameStore';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withSequence,
  withTiming,
  withDelay,
  FadeInDown,
  Easing,
  interpolate,
} from 'react-native-reanimated';
import { MaterialCommunityIcons, Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Clipboard from 'expo-clipboard';
import { notify, confirm } from '../../store/noticeStore';
import { offerPushNotifications } from '../../services/push';

import { GlassCard } from '../../components/GlassCard';
import { AlbumCollageBackground } from '../../components/AlbumCollageBackground';
import { RoomCodeInput } from '../../components/RoomCodeInput';
import { searchArtists, FALLBACK_TOP_ARTISTS } from '../../services/spotify';
import type { SpotifyArtist } from '../../services/spotify';
import { supabase, isSupabaseConfigured } from '../../lib/supabase';
import { useAuthStore } from '../../store/authStore';
import { useRoomStore } from '../../store/roomStore';
import { Colors, Spacing, BorderRadius } from '../../constants/theme';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

// The wordmark shares its row with the profile pill (140 max + 8 margin).
// If the full pill would squeeze the logo under 40px, the pill shows only
// the avatar (10 + 22 + 10 + border + 8 margin) and the logo gets the room.
const LOGO_MAX = 48;
const LOGO_SPACING = 2;
const PILL_FULL = 148;
const PILL_COMPACT = 52;
function logoLayout(windowWidth: number) {
  const inner = windowWidth - Spacing.containerPadding * 2;
  const withFull = wordmarkFontSize(inner - PILL_FULL, LOGO_SPACING, LOGO_MAX);
  if (withFull >= 40) return { size: withFull, compactPill: false };
  return { size: wordmarkFontSize(inner - PILL_COMPACT, LOGO_SPACING, LOGO_MAX), compactPill: true };
}

/** Friends shown before "Show all" in the invite list. */
const FRIENDS_PREVIEW = 4;

const WARM_GOLD = '#ffffff';
const WARM_GOLD_BRIGHT = '#e6e6e6';

export default function HomeScreen() {
  const insets = useSafeAreaInsets();
  const { width: windowWidth } = useWindowDimensions();
  const logo = logoLayout(windowWidth);
  const [joinCode, setJoinCode] = useState('');
  const [showJoinInput, setShowJoinInput] = useState(false);
  // A room you made is still open (e.g. you left the lobby, or a friend
  // declined): come back to it, artist and code together.
  const openRoomArtist = () => {
    const r = useRoomStore.getState();
    return r.roomCode && r.isHost ? r.artist : null;
  };
  const [showCreate, setShowCreate] = useState(() => !!openRoomArtist());
  const [copied, setCopied] = useState(false);

  const [chosenArtist, setChosenArtist] = useState<SpotifyArtist | null>(openRoomArtist);
  const [searchActive, setSearchActive] = useState(() => !openRoomArtist());
  const [artistQuery, setArtistQuery] = useState('');
  const [artistMatches, setArtistMatches] = useState<SpotifyArtist[]>([]);
  const [searching, setSearching] = useState(false);

  const roomCode = useRoomStore((s) => s.roomCode);
  const creatingRoom = useRoomStore((s) => s.creatingRoom);
  const joiningRoom = useRoomStore((s) => s.joiningRoom);
  const createRoom = useRoomStore((s) => s.createRoom);
  const joinRoom = useRoomStore((s) => s.joinRoom);
  const resetRoom = useRoomStore((s) => s.resetRoom);
  const roomArtist = useRoomStore((s) => (s.isHost ? s.artist : null));

  // Back on Home after leaving a room we only joined (Android back skips the
  // lobby's ✕): that room was the host's, so let it go.
  useFocusEffect(
    useCallback(() => {
      const r = useRoomStore.getState();
      if (r.roomCode && !r.isHost && !r.joiningRoom && !useGameStore.getState().roomId) {
        r.resetRoom();
      }
    }, [])
  );

  // Same, when Home stayed mounted: never show a live code without its artist.
  useEffect(() => {
    if (roomCode && roomArtist && !chosenArtist) {
      setChosenArtist(roomArtist);
      setSearchActive(false);
      setShowCreate(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomCode, roomArtist]);

  // Dev-only smoke check: confirms the client reaches Supabase.
  useEffect(() => {
    if (!__DEV__) return;
    if (!isSupabaseConfigured || !supabase) {
      console.warn(
        '[supabase] not configured — set EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY in .env'
      );
      return;
    }
    (async () => {
      try {
        const { error } = await supabase
          .from('track_pools')
          .select('id', { count: 'exact', head: true });
        console.log(
          error
            ? `[supabase] error: ${error.message}`
            : '[supabase] connected OK'
        );
      } catch (e) {
        console.log('[supabase] request failed:', (e as Error)?.message ?? e);
      }
    })();
  }, []);

  // Debounced artist search
  useEffect(() => {
    const query = artistQuery.trim();
    if (!query) {
      setArtistMatches([]);
      setSearching(false);
      return;
    }
    let cancelled = false;
    setSearching(true);
    const timer = setTimeout(async () => {
      const results = await searchArtists(query, 6);
      if (!cancelled) {
        setArtistMatches(results);
        setSearching(false);
      }
    }, 450);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [artistQuery]);

  const ensureRoom = async () => {
    if (roomCode) return true;
    if (!chosenArtist || creatingRoom) return false;
    const res = await createRoom(chosenArtist);
    if (!res.ok) {
      notify.error("Couldn't set up the room", res.error ?? 'Check your connection and try again.', {
        action: { label: 'Try again', onPress: () => ensureRoom() },
      });
      return false;
    }
    return true;
  };

  const toggleCreate = () => {
    const next = !showCreate;
    if (next) {
      ensureRoom();
    }
    setShowCreate(next);
  };

  const startGame = async () => {
    if (!chosenArtist) return;
    const ok = await ensureRoom();
    if (!ok) return;
    // Head into the game screen immediately: the host sees the "Waiting for
    // opponent" screen, and the match auto-starts the second the guest joins.
    router.push('/game');
  };

  const selectArtist = async (artist: SpotifyArtist) => {
    setChosenArtist(artist);
    setSearchActive(false);
    setArtistQuery('');
    setArtistMatches([]);
    if (roomCode) resetRoom();
    const res = await createRoom(artist);
    if (!res.ok) {
      notify.error("Couldn't set up the room", res.error ?? 'Check your connection and try again.', {
        action: { label: 'Try again', onPress: () => selectArtist(artist) },
      });
      return;
    }
    // Came here from a friend's "Play" button: challenge them right away.
    if (pendingChallenge) {
      const target = pendingChallenge;
      setPendingChallenge(null);
      await challengeFriend(target);
    }
  };

  // When a room ends (e.g. after a match the results screen clears it), Home
  // must forget it too: it's a tab, so its local artist/panel state survives.
  // Ignore the brief reset while a new room is being built for a new artist.
  const prevRoomCode = useRef(roomCode);
  useEffect(() => {
    const had = prevRoomCode.current;
    prevRoomCode.current = roomCode;
    if (had && !roomCode && !useRoomStore.getState().creatingRoom) {
      setChosenArtist(null);
      setShowCreate(false);
      setSearchActive(true);
      setArtistQuery('');
      setArtistMatches([]);
      setCopied(false);
    }
  }, [roomCode]);

  // ─── Challenge a friend (no room code) ───────────────────────────────
  const params = useLocalSearchParams<{ challenge?: string; challengeName?: string }>();
  const [pendingChallenge, setPendingChallenge] = useState<{ id: string; name: string } | null>(null);
  const [friendsToInvite, setFriendsToInvite] = useState<Friend[]>([]);
  const [invitingId, setInvitingId] = useState<string | null>(null);
  const [showAllFriends, setShowAllFriends] = useState(false);

  useFocusEffect(
    useCallback(() => {
      listFriends().then((res) => {
        if (!res.error) setFriendsToInvite((res.data ?? []).filter((f) => f.relation === 'friend'));
      });
    }, [])
  );

  // Friends tab → "Play": open the create panel and remember who to invite.
  useEffect(() => {
    if (!params.challenge) return;
    setPendingChallenge({ id: params.challenge, name: params.challengeName || 'your friend' });
    setShowCreate(true);
    setSearchActive(true);
    router.setParams({ challenge: undefined, challengeName: undefined });
  }, [params.challenge, params.challengeName]);

  const challengeFriend = async (friend: { id: string; name: string }) => {
    const ok = await ensureRoom();
    const roomId = useRoomStore.getState().roomId;
    if (!ok || !roomId) return;
    setInvitingId(friend.id);
    const res = await useInviteStore.getState().invite(friend, roomId);
    setInvitingId(null);
    if (res.error) {
      notify.error(`Couldn't challenge ${friend.name}`, res.error, {
        action: { label: 'Try again', onPress: () => challengeFriend(friend) },
      });
      return;
    }
    // A good moment to offer notifications: they just challenged someone.
    offerPushNotifications('challenge');
    // Into the lobby: the match starts the moment they tap Join.
    router.push('/game');
  };

  const handleJoinRoom = async () => {
    if (joinCode.length === 6) {
      const res = await joinRoom(joinCode);
      if (!res.ok) {
        notify.error("Couldn't join that room", res.error ?? 'Check the code and try again.');
        return;
      }
      router.push('/game');
    }
  };

  const handleShareInvite = async () => {
    const ok = await ensureRoom();
    if (!ok) return;
    try {
      await Share.share({
        message: `Join my Interlude room! Code: ${roomCode}\n\nOpen Interlude, tap "Join a Room" and enter the code.`,
        title: 'Join my Interlude game!',
      });
    } catch (e) {
      // Silently handle
    }
  };

  const handleCopyLink = async () => {
    const ok = await ensureRoom();
    if (!ok) return;
    await Clipboard.setStringAsync(roomCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  };

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      {/* Spotify-aesthetic album collage background */}
      <AlbumCollageBackground />

      <KeyboardAvoidingView 
        style={{ flex: 1 }} 
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={[
            styles.scrollContent,
            { paddingBottom: insets.bottom + 100 },
          ]}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
        {/* Header */}
        <Animated.View
          entering={FadeInDown.delay(100).duration(600)}
          style={styles.header}
        >
          <View style={styles.logoRow}>
            <Text
              style={[styles.logoText, { fontSize: logo.size, lineHeight: Math.round(logo.size * 1.1) }]}
              numberOfLines={1}
              allowFontScaling={false}
              adjustsFontSizeToFit
              minimumFontScale={0.6}
            >
              {WORDMARK_TEXT}
            </Text>
            <AuthPill compact={logo.compactPill} />
          </View>
          <Text style={styles.subtitle}>
            Choose an artist. Challenge your friend. Guess the track.
          </Text>
        </Animated.View>

        {/* Create Room */}
        <Animated.View entering={FadeInDown.delay(350).duration(600)}>
          <Pressable onPress={toggleCreate}>
            <GlassCard borderRadius={24} padding={0}>
              <View style={styles.actionCard}>
                <View style={styles.actionCardLeft}>
                  <View style={styles.actionIcon}>
                    <MaterialCommunityIcons
                      name="plus-circle-outline"
                      size={28}
                      color={Colors.primary}
                    />
                  </View>
                  <View style={styles.actionTextContainer}>
                    <Text style={styles.actionTitle}>Create a Room</Text>
                    <Text style={styles.actionDesc}>
                      Pick an artist, then challenge a friend
                    </Text>
                  </View>
                </View>
                <Ionicons
                  name={showCreate ? 'chevron-up' : 'chevron-forward'}
                  size={20}
                  color={Colors.textSubtle}
                />
              </View>
            </GlassCard>
          </Pressable>
        </Animated.View>

        {/* Create Room Content (expandable) */}
        {showCreate && (
          <Animated.View entering={FadeInDown.duration(300)}>
            <GlassCard borderRadius={24} padding={20}>
              {/* Came from a friend's "Play" button */}
              {pendingChallenge ? (
                <View style={styles.challengeBanner}>
                  <Ionicons name="flash" size={16} color="#000000" />
                  <Text style={styles.challengeBannerText}>
                    Challenging {pendingChallenge.name}. Pick an artist to send it.
                  </Text>
                  <Pressable onPress={() => setPendingChallenge(null)} hitSlop={10} accessibilityLabel="Cancel challenge">
                    <Ionicons name="close" size={18} color="#000000" />
                  </Pressable>
                </View>
              ) : null}

              {/* ── Step 1: artist ───────────────────────────── */}
              <StepHeader
                n={1}
                title="Pick an artist"
                done={!!chosenArtist && !searchActive}
              />

              {searchActive || !chosenArtist ? (
                <View style={styles.stepBody}>
                  <View style={styles.searchRow}>
                    <Ionicons name="search" size={18} color={Colors.textSubtle} />
                    <TextInput
                      style={styles.searchInput}
                      value={artistQuery}
                      onChangeText={setArtistQuery}
                      placeholder="Search any artist"
                      placeholderTextColor={Colors.textSubtle}
                      autoCapitalize="words"
                      autoCorrect={false}
                      returnKeyType="search"
                    />
                    {artistQuery.length > 0 ? (
                      <Pressable onPress={() => setArtistQuery('')} hitSlop={10} accessibilityLabel="Clear search">
                        <Ionicons name="close-circle" size={18} color={Colors.textSubtle} />
                      </Pressable>
                    ) : null}
                  </View>

                  {artistQuery.trim().length > 0 ? (
                    artistMatches.length > 0 ? (
                      <View style={styles.resultList}>
                        {artistMatches.map((artist) => {
                          const active = chosenArtist?.id === artist.id;
                          return (
                            <Pressable key={artist.id} onPress={() => selectArtist(artist)}>
                              <View style={[styles.resultRow, active && styles.resultRowActive]}>
                                <ArtistAvatar
                                  uri={artist.thumb || artist.image}
                                  style={styles.resultImage}
                                  iconSize={18}
                                />
                                <Text style={styles.resultName}>
                                  {artist.name}
                                </Text>
                                <Ionicons
                                  name={active ? 'checkmark-circle' : 'chevron-forward'}
                                  size={18}
                                  color={active ? WARM_GOLD : Colors.textSubtle}
                                />
                              </View>
                            </Pressable>
                          );
                        })}
                      </View>
                    ) : (
                      <Text style={styles.searchStatus}>
                        {searching ? 'Searching...' : 'No artists found. Try another spelling.'}
                      </Text>
                    )
                  ) : (
                    <Text style={styles.searchStatus}>
                      The match uses 10 songs by the artist you pick.
                    </Text>
                  )}

                  {chosenArtist ? (
                    <Pressable onPress={() => setSearchActive(false)} hitSlop={6}>
                      <Text style={styles.linkButton}>Keep {chosenArtist.name}</Text>
                    </Pressable>
                  ) : null}
                </View>
              ) : (
                <View style={[styles.stepBody, styles.artistCard]}>
                  <View style={styles.artistCardTop}>
                    <ArtistAvatar
                      uri={chosenArtist.image || chosenArtist.thumb}
                      style={styles.artistCardImage}
                      iconSize={28}
                    />
                    <View style={styles.artistCardText}>
                      <Text style={styles.artistCardLabel}>Playing with</Text>
                      <Text style={styles.artistCardName}>
                        {chosenArtist.name}
                      </Text>
                      <View style={styles.artistStatus}>
                        {creatingRoom ? (
                          <>
                            <ActivityIndicator size="small" color={WARM_GOLD_BRIGHT} />
                            <Text style={styles.artistStatusText}>Building your 10-song list...</Text>
                          </>
                        ) : roomCode ? (
                          <>
                            <Ionicons name="checkmark-circle" size={14} color={Colors.correct} />
                            <Text style={styles.artistStatusText}>Ready. Invite your opponent below.</Text>
                          </>
                        ) : null}
                      </View>
                    </View>
                  </View>
                  <Pressable
                    onPress={() => setSearchActive(true)}
                    accessibilityRole="button"
                    accessibilityLabel="Change artist"
                  >
                    <View style={styles.changeArtist}>
                      <Ionicons name="swap-horizontal" size={15} color="#ffffff" />
                      <Text style={styles.changeArtistText}>Change artist</Text>
                    </View>
                  </Pressable>
                </View>
              )}

              {/* ── Step 2: invite ───────────────────────────── */}
              <StepHeader
                n={2}
                title="Invite your opponent"
                hint={roomCode ? undefined : 'Pick an artist first'}
              />
              <View style={[styles.stepBody, !roomCode && styles.stepLocked]} pointerEvents={roomCode ? 'auto' : 'none'}>
                {friendsToInvite.length > 0 ? (
                  <>
                    <Text style={styles.subLabel}>Challenge a friend</Text>
                    <Text style={styles.subHint}>They get a pop-up and join with one tap.</Text>
                    <View style={styles.friendList}>
                      {(showAllFriends ? friendsToInvite : friendsToInvite.slice(0, FRIENDS_PREVIEW)).map((f, i) => {
                        const fullName = f.display_name || `@${f.username}`;
                        const busy = invitingId === f.id;
                        const disabled = !roomCode || creatingRoom || invitingId !== null;
                        return (
                          <View key={f.id} style={[styles.friendRow, i > 0 && styles.friendRowDivider]}>
                            <PlayerAvatar uri={f.avatar_url} name={fullName} size={42} />
                            <View style={styles.friendText}>
                              <Text style={styles.friendName}>
                                {fullName}
                              </Text>
                              <Text style={styles.friendSub}>
                                @{f.username}
                                {f.wins + f.losses + f.draws > 0 ? `  ·  ${f.wins}-${f.losses}${f.draws ? `-${f.draws}` : ''}` : ''}
                              </Text>
                            </View>
                            <Pressable
                              disabled={disabled}
                              onPress={() => challengeFriend({ id: f.id, name: fullName })}
                              accessibilityRole="button"
                              accessibilityLabel={`Challenge ${fullName}`}
                            >
                              <View style={[styles.challengeButton, disabled && !busy && styles.challengeButtonMuted]}>
                                {busy ? (
                                  <ActivityIndicator size="small" color="#000000" />
                                ) : (
                                  <>
                                    <Ionicons name="flash" size={13} color="#000000" />
                                    <Text style={styles.challengeButtonText}>Challenge</Text>
                                  </>
                                )}
                              </View>
                            </Pressable>
                          </View>
                        );
                      })}
                    </View>
                    {friendsToInvite.length > FRIENDS_PREVIEW ? (
                      <Pressable onPress={() => setShowAllFriends((v) => !v)} hitSlop={6}>
                        <Text style={styles.linkButton}>
                          {showAllFriends ? 'Show fewer' : `Show all ${friendsToInvite.length} friends`}
                        </Text>
                      </Pressable>
                    ) : null}
                  </>
                ) : (
                  <Pressable onPress={() => router.push('/friends')}>
                    <View style={styles.noFriends}>
                      <Ionicons name="person-add-outline" size={18} color="#ffffff" />
                      <Text style={styles.noFriendsText}>
                        Add friends to challenge them with one tap
                      </Text>
                      <Ionicons name="chevron-forward" size={16} color={Colors.textSubtle} />
                    </View>
                  </Pressable>
                )}

                {/* Or share a code */}
                <View style={styles.orRow}>
                  <View style={styles.orLine} />
                  <Text style={styles.orText}>or share a room code</Text>
                  <View style={styles.orLine} />
                </View>

                <View style={styles.codeBox}>
                  <Text
                    style={roomCode ? styles.codeText : styles.codePlaceholder}
                    numberOfLines={1}
                    adjustsFontSizeToFit
                    allowFontScaling={false}
                  >
                    {roomCode || '------'}
                  </Text>
                  <View style={styles.codeActions}>
                    <Pressable onPress={handleCopyLink} disabled={!roomCode} accessibilityLabel="Copy room code">
                      <View style={styles.codeAction}>
                        <Ionicons name={copied ? 'checkmark' : 'copy-outline'} size={16} color="#ffffff" />
                        <Text style={styles.codeActionText}>{copied ? 'Copied' : 'Copy'}</Text>
                      </View>
                    </Pressable>
                    <Pressable onPress={handleShareInvite} disabled={!roomCode} accessibilityLabel="Share room code">
                      <View style={styles.codeAction}>
                        <Ionicons name="share-outline" size={16} color="#ffffff" />
                        <Text style={styles.codeActionText}>Share</Text>
                      </View>
                    </Pressable>
                  </View>
                </View>
              </View>

              {/* Main action */}
              <Pressable
                onPress={startGame}
                disabled={!chosenArtist || creatingRoom}
                accessibilityRole="button"
              >
                <View style={[styles.startButton, (!chosenArtist || creatingRoom) && styles.startButtonDisabled]}>
                  {creatingRoom ? (
                    <ActivityIndicator size="small" color="#000000" />
                  ) : (
                    <>
                      <Text style={styles.startButtonText}>Go to lobby</Text>
                      <Ionicons name="arrow-forward" size={18} color="#000000" />
                    </>
                  )}
                </View>
              </Pressable>
              <Text style={styles.startHint}>
                The match starts as soon as your opponent joins.
              </Text>
            </GlassCard>
          </Animated.View>
        )}

        {/* Join Room */}
        <Animated.View entering={FadeInDown.delay(450).duration(600)}>
          <Pressable onPress={() => setShowJoinInput(!showJoinInput)}>
            <GlassCard borderRadius={24} padding={0}>
              <View style={styles.actionCard}>
                <View style={styles.actionCardLeft}>
                  <View style={styles.actionIcon}>
                    <MaterialCommunityIcons
                      name="login-variant"
                      size={28}
                      color={Colors.primary}
                    />
                  </View>
                  <View style={styles.actionTextContainer}>
                    <Text style={styles.actionTitle}>Join a Room</Text>
                    <Text style={styles.actionDesc}>
                      Got a 6-letter code? Enter it here
                    </Text>
                  </View>
                </View>
                <Ionicons
                  name={showJoinInput ? 'chevron-up' : 'chevron-forward'}
                  size={20}
                  color={Colors.textSubtle}
                />
              </View>
            </GlassCard>
          </Pressable>
        </Animated.View>

        {/* Join Code Input (expandable) */}
        {showJoinInput && (
          <Animated.View entering={FadeInDown.duration(300)}>
            <GlassCard borderRadius={24}>
              <Text style={styles.joinLabel}>Room Code</Text>
              <View style={styles.joinInputContainer}>
                <RoomCodeInput value={joinCode} onChange={setJoinCode} />
              </View>
              <Pressable
                onPress={handleJoinRoom}
                style={[
                  styles.joinButton,
                  (joinCode.length < 6 || joiningRoom) && styles.joinButtonDisabled,
                ]}
                disabled={joinCode.length < 6 || joiningRoom}
              >
                {joiningRoom ? (
                  <ActivityIndicator size="small" color={Colors.background} />
                ) : (
                  <Text style={styles.joinButtonText}>Join Game</Text>
                )}
              </Pressable>
            </GlassCard>
          </Animated.View>
        )}
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

// ─── Floating particle accents ────────────────────────────────────────
const PARTICLE_COUNT = 8;

function FloatingParticles() {
  const particles = React.useMemo(() => {
    return Array.from({ length: PARTICLE_COUNT }, (_, i) => ({
      id: i,
      x: (i * 47 + 13) % SCREEN_WIDTH,
      y: (i * 89 + 31) % (SCREEN_HEIGHT * 0.6),
      size: 2 + (i % 3) * 1.5,
      delay: i * 400,
      duration: 3000 + (i % 4) * 1000,
      color: i % 3 === 0
        ? 'rgba(255, 255, 255, 0.35)'
        : i % 3 === 1
          ? 'rgba(200, 200, 200, 0.3)'
          : 'rgba(255, 255, 255, 0.3)',
    }));
  }, []);

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      {particles.map((p) => (
        <FloatingDot key={p.id} config={p} />
      ))}
    </View>
  );
}

function FloatingDot({ config }: { config: any }) {
  const anim = useSharedValue(0);

  useEffect(() => {
    anim.value = withDelay(
      config.delay,
      withRepeat(
        withSequence(
          withTiming(1, {
            duration: config.duration,
            easing: Easing.inOut(Easing.sin),
          }),
          withTiming(0, {
            duration: config.duration,
            easing: Easing.inOut(Easing.sin),
          })
        ),
        -1,
        true
      )
    );
  }, []);

  const dotStyle = useAnimatedStyle(() => {
    const translateY = interpolate(anim.value, [0, 1], [0, -20]);
    const opacity = interpolate(anim.value, [0, 0.5, 1], [0.2, 0.8, 0.2]);

    return {
      transform: [{ translateY }],
      opacity,
    };
  });

  return (
    <Animated.View
      style={[
        {
          position: 'absolute',
          left: config.x,
          top: config.y,
          width: config.size,
          height: config.size,
          borderRadius: config.size / 2,
          backgroundColor: config.color,
        },
        dotStyle,
      ]}
    />
  );
}

// ─── Numbered step header ────────────────────────────────────────────
function StepHeader({ n, title, hint, done }: { n: number; title: string; hint?: string; done?: boolean }) {
  return (
    <View style={styles.stepHeader}>
      <View style={[styles.stepNumber, done && styles.stepNumberDone]}>
        {done ? (
          <Ionicons name="checkmark" size={15} color="#000000" />
        ) : (
          <Text style={styles.stepNumberText}>{n}</Text>
        )}
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.stepTitle}>{title}</Text>
        {hint ? <Text style={styles.stepHint}>{hint}</Text> : null}
      </View>
    </View>
  );
}

// ─── Artist avatar ───────────────────────────────────────────────────

/**
 * Round artist picture that never shows as an empty circle: the music-note
 * placeholder stays underneath until the photo has actually loaded, and stays
 * on its own if the photo fails (the failure is logged for debugging).
 */
function ArtistAvatar({
  uri,
  style,
  iconSize,
}: {
  uri?: string;
  style: any;
  iconSize: number;
}) {
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setLoaded(false);
    setFailed(false);
  }, [uri]);

  return (
    <View style={[style, styles.avatarFrame]}>
      <MaterialCommunityIcons name="music-note" size={iconSize} color={WARM_GOLD} />
      {uri && !failed ? (
        <Image
          source={{ uri }}
          // Decode at the circle's size on Android instead of full resolution.
          resizeMethod="resize"
          style={[StyleSheet.absoluteFill, { opacity: loaded ? 1 : 0 }]}
          onLoad={() => setLoaded(true)}
          onError={(e) => {
            console.warn('[ArtistAvatar] failed to load', uri, e?.nativeEvent?.error);
            setFailed(true);
          }}
        />
      ) : null}
    </View>
  );
}

// ─── Google sign-in pill ─────────────────────────────────────────────
function AuthPill({ compact = false }: { compact?: boolean }) {
  const session = useAuthStore((s) => s.session);
  const profile = useAuthStore((s) => s.profile);
  const loading = useAuthStore((s) => s.loading);
  const signOut = useAuthStore((s) => s.signOut);

  const handlePress = async () => {
    if (session) {
      const ok = await confirm({
        title: 'Log out of Interlude?',
        message: `Signed in as ${profile?.display_name ?? 'Interlude player'} with Google. You can sign back in anytime.`,
        confirmLabel: 'Log out',
        destructive: true,
        icon: 'log-out-outline',
      });
      if (!ok) return;
      await signOut();
      router.replace('/login');
      return;
    }
    router.replace('/login');
  };

  if (loading) return null;

  if (profile) {
    return (
      <Pressable onPress={handlePress} hitSlop={8} style={styles.authPill}>
        {profile.avatar_url ? (
          <Image source={{ uri: profile.avatar_url }} style={styles.authAvatar} />
        ) : (
          <View style={styles.authAvatar}>
            <Ionicons name="person" size={16} color={WARM_GOLD} />
          </View>
        )}
        {compact ? null : (
          <Text style={styles.authName} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>
          {profile.display_name?.trim().split(/\s+/)[0] || 'You'}
        </Text>
        )}
      </Pressable>
    );
  }

  return (
    <Pressable onPress={handlePress} hitSlop={8} style={styles.authPill}>
      <Ionicons name="logo-google" size={15} color={WARM_GOLD} />
      <Text style={styles.authName}>Sign in</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: '#0a0a0a',
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    padding: Spacing.containerPadding,
    gap: Spacing.md,
  },
  header: {
    marginBottom: Spacing.sm,
    marginTop: Spacing.md,
  },
  logoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: Spacing.xs,
    width: '100%',
  },
  authPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    height: 32,
    maxWidth: 140,
    backgroundColor: 'rgba(24, 24, 24, 0.7)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.28)',
    borderRadius: BorderRadius.full,
    paddingHorizontal: 10,
    marginLeft: 8,
  },
  authAvatar: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: 'rgba(255, 255, 255, 0.14)',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  authName: {
    fontFamily: 'Inter-Bold',
    fontSize: 12,
    lineHeight: 15,
    color: Colors.primary,
    flexShrink: 1,
    includeFontPadding: false,
    textAlignVertical: 'center',
  },
  logoText: {
    fontFamily: 'Antonio',
    color: '#ffffff',
    letterSpacing: LOGO_SPACING,
    textTransform: 'uppercase',
    textShadowColor: 'rgba(0, 0, 0, 0.95)',
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 8,
    flexShrink: 1,
  },
  subtitle: {
    fontFamily: 'Inter-Bold',
    fontSize: 15,
    color: '#ffffff',
    marginTop: 4,
    letterSpacing: 0.3,
    opacity: 0.95,
    textShadowColor: 'rgba(0, 0, 0, 0.95)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 6,
  },

  // Action Cards
  actionCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: Spacing.lg,
  },
  actionCardLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    flex: 1,
  },
  actionIcon: {
    width: 48,
    height: 48,
    borderRadius: 14,
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionTextContainer: {
    flex: 1,
  },
  actionTitle: {
    fontFamily: 'Inter-Bold',
    fontSize: 16,
    color: Colors.primary,
    marginBottom: 2,
  },
  actionDesc: {
    fontFamily: 'Inter',
    fontSize: 13,
    color: Colors.textMuted,
  },

  // Create panel: steps
  stepHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 12,
  },
  stepNumber: {
    width: 26,
    height: 26,
    borderRadius: 13,
    borderWidth: 1.5,
    borderColor: 'rgba(255, 255, 255, 0.5)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepNumberDone: { backgroundColor: '#ffffff', borderColor: '#ffffff' },
  stepNumberText: { fontFamily: 'Inter-Bold', fontSize: 13, color: '#ffffff' },
  stepTitle: { fontFamily: 'Inter-Bold', fontSize: 16, color: Colors.primary },
  stepHint: { fontFamily: 'Inter', fontSize: 12, color: Colors.textMuted, marginTop: 1 },
  stepBody: { marginBottom: Spacing.lg },
  stepLocked: { opacity: 0.4 },

  // Step 1: search
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    backgroundColor: 'rgba(255, 255, 255, 0.07)',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.16)',
    paddingHorizontal: 14,
    height: 48,
  },
  searchInput: {
    flex: 1,
    fontFamily: 'Inter',
    fontSize: 15,
    color: Colors.primary,
    padding: 0,
  },
  resultList: { marginTop: 8, gap: 2 },
  resultRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    minHeight: 56,
    paddingVertical: 6,
    paddingHorizontal: 8,
    borderRadius: 12,
  },
  resultRowActive: { backgroundColor: 'rgba(255, 255, 255, 0.1)' },
  resultImage: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: Colors.surfaceContainer,
  },
  resultName: {
    flex: 1,
    fontFamily: 'Inter-Bold',
    fontSize: 15,
    lineHeight: 20,
    color: Colors.primary,
  },
  searchStatus: {
    fontFamily: 'Inter',
    fontSize: 13,
    color: Colors.textMuted,
    marginTop: 10,
    textAlign: 'center',
  },
  linkButton: {
    fontFamily: 'Inter-Bold',
    fontSize: 13,
    color: Colors.textSubtle,
    textAlign: 'center',
    textDecorationLine: 'underline',
    marginTop: 12,
  },
  avatarFrame: {
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },

  // Step 1: chosen artist
  artistCard: {
    backgroundColor: 'rgba(255, 255, 255, 0.07)',
    borderRadius: 18,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.16)',
    overflow: 'hidden',
  },
  artistCardTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    padding: 14,
  },
  artistCardImage: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: Colors.surfaceContainer,
  },
  artistCardText: { flex: 1, minWidth: 0 },
  artistCardLabel: {
    fontFamily: 'Inter-Bold',
    fontSize: 11,
    color: Colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 1.2,
  },
  artistCardName: {
    fontFamily: 'Inter-Bold',
    fontSize: 20,
    lineHeight: 25,
    color: Colors.primary,
    marginTop: 2,
  },
  artistStatus: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 6 },
  artistStatusText: { fontFamily: 'Inter', fontSize: 12, color: Colors.textSubtle, flexShrink: 1 },
  changeArtist: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    height: 44,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255, 255, 255, 0.1)',
  },
  changeArtistText: { fontFamily: 'Inter-Bold', fontSize: 14, color: '#ffffff' },

  // Step 2: friends
  challengeBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    backgroundColor: '#ffffff',
    borderRadius: 12,
    paddingHorizontal: Spacing.md,
    paddingVertical: 10,
    marginBottom: Spacing.md,
  },
  challengeBannerText: {
    flex: 1,
    fontFamily: 'Inter-Bold',
    fontSize: 13,
    color: '#000000',
  },
  subLabel: { fontFamily: 'Inter-Bold', fontSize: 14, color: Colors.primary },
  subHint: { fontFamily: 'Inter', fontSize: 12, color: Colors.textMuted, marginTop: 2, marginBottom: 8 },
  friendList: {
    borderRadius: 16,
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
  },
  friendRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    minHeight: 64,
    paddingVertical: 10,
    paddingHorizontal: 12,
  },
  friendRowDivider: { borderTopWidth: 1, borderTopColor: 'rgba(255, 255, 255, 0.07)' },
  friendText: { flex: 1, minWidth: 0 },
  friendName: { fontFamily: 'Inter-Bold', fontSize: 15, color: '#ffffff' },
  friendSub: { fontFamily: 'Inter', fontSize: 12, color: Colors.textMuted, marginTop: 2 },
  challengeButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    height: 36,
    minWidth: 104,
    paddingHorizontal: 14,
    borderRadius: BorderRadius.full,
    backgroundColor: '#ffffff',
  },
  challengeButtonMuted: { opacity: 0.45 },
  challengeButtonText: { fontFamily: 'Inter-Bold', fontSize: 13, color: '#000000' },
  noFriends: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    minHeight: 52,
    paddingHorizontal: 14,
    borderRadius: 14,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: 'rgba(255, 255, 255, 0.25)',
  },
  noFriendsText: { flex: 1, fontFamily: 'Inter-Bold', fontSize: 13, color: '#ffffff' },

  // Step 2: code
  orRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginVertical: 16 },
  orLine: { flex: 1, height: 1, backgroundColor: 'rgba(255, 255, 255, 0.12)' },
  orText: { fontFamily: 'Inter', fontSize: 12, color: Colors.textMuted },
  codeBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingLeft: 16,
    paddingRight: 8,
    height: 60,
    borderRadius: 16,
    backgroundColor: 'rgba(255, 255, 255, 0.07)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.16)',
  },
  codeText: {
    flex: 1,
    fontFamily: 'Inter-Bold',
    fontSize: 24,
    letterSpacing: 5,
    color: '#ffffff',
  },
  codePlaceholder: {
    flex: 1,
    fontFamily: 'Inter-Bold',
    fontSize: 24,
    letterSpacing: 5,
    color: 'rgba(255, 255, 255, 0.25)',
  },
  codeActions: { flexDirection: 'row', gap: 6 },
  codeAction: {
    alignItems: 'center',
    justifyContent: 'center',
    width: 56,
    height: 46,
    borderRadius: 12,
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    gap: 2,
  },
  codeActionText: { fontFamily: 'Inter-Bold', fontSize: 10, color: '#ffffff' },

  // Main action
  startButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    height: 54,
    backgroundColor: WARM_GOLD,
    borderRadius: BorderRadius.full,
  },
  startButtonText: {
    fontFamily: 'Inter-Bold',
    fontSize: 16,
    color: '#000000',
  },
  startButtonDisabled: {
    opacity: 0.35,
  },
  startHint: {
    fontFamily: 'Inter',
    fontSize: 12,
    color: Colors.textMuted,
    textAlign: 'center',
    marginTop: 8,
  },

  // Join
  joinLabel: {
    fontFamily: 'Inter',
    fontSize: 13,
    color: Colors.textSubtle,
    marginBottom: Spacing.md,
    textAlign: 'center',
    textTransform: 'uppercase',
    letterSpacing: 2,
  },
  joinInputContainer: {
    marginBottom: Spacing.lg,
  },
  joinButton: {
    backgroundColor: Colors.primary,
    borderRadius: BorderRadius.lg,
    paddingVertical: 16,
    alignItems: 'center',
  },
  joinButtonDisabled: {
    opacity: 0.3,
  },
  joinButtonText: {
    fontFamily: 'Inter-Bold',
    fontSize: 16,
    color: Colors.background,
  },
});