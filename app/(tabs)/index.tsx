import React, { useState, useEffect } from 'react';
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
  Alert,
  ActivityIndicator,
} from 'react-native';
import { router } from 'expo-router';
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

const WARM_GOLD = '#e8a95c';
const WARM_GOLD_BRIGHT = '#ffc98a';

export default function HomeScreen() {
  const insets = useSafeAreaInsets();
  const [joinCode, setJoinCode] = useState('');
  const [showJoinInput, setShowJoinInput] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [copied, setCopied] = useState(false);

  const [chosenArtist, setChosenArtist] = useState<SpotifyArtist | null>(null);
  const [searchActive, setSearchActive] = useState(true);
  const [artistQuery, setArtistQuery] = useState('');
  const [artistMatches, setArtistMatches] = useState<SpotifyArtist[]>([]);
  const [searching, setSearching] = useState(false);

  const roomCode = useRoomStore((s) => s.roomCode);
  const creatingRoom = useRoomStore((s) => s.creatingRoom);
  const joiningRoom = useRoomStore((s) => s.joiningRoom);
  const createRoom = useRoomStore((s) => s.createRoom);
  const joinRoom = useRoomStore((s) => s.joinRoom);
  const resetRoom = useRoomStore((s) => s.resetRoom);

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
      Alert.alert('Could not create room', res.error ?? 'Something went wrong');
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
      Alert.alert('Could not create room', res.error ?? 'Something went wrong');
    }
  };

  const handleJoinRoom = async () => {
    if (joinCode.length === 6) {
      const res = await joinRoom(joinCode);
      if (!res.ok) {
        Alert.alert('Could not join room', res.error ?? 'Something went wrong');
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
        message: `Join my Interlude room! Code: ${roomCode}\n\nPlay now: interlude://join/${roomCode}`,
        title: 'Join my Interlude game!',
      });
    } catch (e) {
      // Silently handle
    }
  };

  const handleCopyLink = async () => {
    const ok = await ensureRoom();
    if (!ok) return;
    await Clipboard.setStringAsync(`interlude://join/${roomCode}`);
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  };

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      {/* Spotify-aesthetic album collage background */}
      <AlbumCollageBackground />

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[
          styles.scrollContent,
          { paddingBottom: insets.bottom + 100 },
        ]}
        showsVerticalScrollIndicator={false}
      >
        {/* Header */}
        <Animated.View
          entering={FadeInDown.delay(100).duration(600)}
          style={styles.header}
        >
          <View style={styles.logoRow}>
            <Text style={styles.logoText} numberOfLines={1}>
              INTERLUDE.
            </Text>
            <AuthPill />
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
                      Host a room and share the invite link
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
            <GlassCard borderRadius={24}>
              {/* Choose artist */}
              <Text style={styles.chooseLabel}>Choose your artist</Text>
              <Text style={styles.chooseHint}>
                Search to pick the artist for your room
              </Text>

              {searchActive ? (
                <>
                  <View style={styles.searchRow}>
                    <Ionicons
                      name="search"
                      size={18}
                      color={Colors.textSubtle}
                    />
                    <TextInput
                      style={styles.searchInput}
                      value={artistQuery}
                      onChangeText={setArtistQuery}
                      placeholder="Search an artist..."
                      placeholderTextColor={Colors.textSubtle}
                      autoCapitalize="words"
                      autoCorrect={false}
                      returnKeyType="search"
                    />
                  </View>

                  {artistQuery.trim().length > 0 &&
                    (artistMatches.length > 0 ? (
                      <View style={styles.resultList}>
                        {artistMatches.map((artist) => (
                          <Pressable
                            key={artist.id}
                            onPress={() => selectArtist(artist)}
                            style={[
                              styles.resultRow,
                              chosenArtist?.id === artist.id &&
                                styles.resultRowActive,
                            ]}
                          >
                            {artist.image ? (
                              <Image
                                source={{ uri: artist.image }}
                                style={styles.resultImage}
                              />
                            ) : (
                              <View style={styles.resultImagePlaceholder}>
                                <MaterialCommunityIcons
                                  name="music-note"
                                  size={18}
                                  color={WARM_GOLD}
                                />
                              </View>
                            )}
                            <Text style={styles.resultName} numberOfLines={1}>
                              {artist.name}
                            </Text>
                            <Ionicons
                              name={
                                chosenArtist?.id === artist.id
                                  ? 'checkmark-circle'
                                  : 'chevron-forward'
                              }
                              size={18}
                              color={
                                chosenArtist?.id === artist.id
                                  ? WARM_GOLD
                                  : Colors.textSubtle
                              }
                            />
                          </Pressable>
                        ))}
                      </View>
                    ) : (
                      <Text style={styles.searchStatus}>
                        {searching ? 'Searching...' : 'No artists found'}
                      </Text>
                    ))}
                </>
              ) : chosenArtist ? (
                <View style={styles.chosenRow}>
                  <Image
                    source={{ uri: chosenArtist.image }}
                    style={styles.chosenImage}
                  />
                  <View style={styles.chosenText}>
                    <Text style={styles.chosenLabel}>Playing with</Text>
                    <Text style={styles.chosenName} numberOfLines={2}>
                      {chosenArtist.name}
                    </Text>
                  </View>
                  <Pressable
                    onPress={() => setSearchActive(true)}
                    hitSlop={8}
                    style={styles.changeButton}
                  >
                    <Ionicons
                      name="create-outline"
                      size={14}
                      color={WARM_GOLD}
                    />
                    <Text style={styles.changeButtonText}>Change</Text>
                  </Pressable>
                </View>
              ) : (
                <Pressable
                  onPress={() => setSearchActive(true)}
                  style={styles.noArtistRow}
                >
                  <View style={styles.noArtistIcon}>
                    <MaterialCommunityIcons name="music-note-plus" size={22} color={WARM_GOLD} />
                  </View>
                  <View style={styles.chosenText}>
                    <Text style={styles.chosenLabel}>No artist selected</Text>
                    <Text style={styles.noArtistHint}>Tap to search and pick an artist</Text>
                  </View>
                  <Ionicons name="chevron-forward" size={18} color={WARM_GOLD} />
                </Pressable>
              )}

              <View style={styles.divider} />

              {/* Invite */}
              <View style={styles.inviteHeaderRow}>
                <View style={styles.inviteIconRing}>
                  <Ionicons name="link-outline" size={18} color={WARM_GOLD} />
                </View>
                <View style={styles.inviteHeaderText}>
                  <Text style={styles.inviteLabel}>Invite a friend</Text>
                  <Text style={styles.inviteHint}>
                    Share your room link to start playing
                  </Text>
                </View>
              </View>

              <View style={styles.linkRow}>
                {creatingRoom ? (
                  <View style={styles.linkLoading}>
                    <ActivityIndicator size="small" color={WARM_GOLD_BRIGHT} />
                    <Text style={styles.linkLoadingText}>
                      Building your 10-track pool...
                    </Text>
                  </View>
                ) : (
                  <Text style={styles.linkText} numberOfLines={1}>
                    interlude://join/{roomCode}
                  </Text>
                )}
                <Pressable
                  onPress={handleCopyLink}
                  hitSlop={8}
                  style={styles.copyButton}
                  disabled={creatingRoom || !roomCode}
                >
                  <Ionicons
                    name={copied ? 'checkmark' : 'copy-outline'}
                    size={18}
                    color={copied ? WARM_GOLD : Colors.primary}
                  />
                </Pressable>
              </View>

              <View style={styles.inviteButtonsRow}>
                <Pressable
                  onPress={handleShareInvite}
                  disabled={creatingRoom || !roomCode}
                  style={[
                    styles.shareButton,
                    (creatingRoom || !roomCode) && styles.buttonMuted,
                  ]}
                >
                  <Ionicons name="share-outline" size={16} color="#241505" />
                  <Text style={styles.shareButtonText}>Share Invite</Text>
                </Pressable>
                <Pressable
                  onPress={startGame}
                  style={[
                    styles.startButton,
                    (!chosenArtist || creatingRoom) && styles.startButtonDisabled,
                  ]}
                  disabled={!chosenArtist || creatingRoom}
                >
                  {creatingRoom ? (
                    <ActivityIndicator size="small" color="#241505" />
                  ) : (
                    <>
                      <Text style={styles.startButtonText}>Start Game</Text>
                      <Ionicons name="arrow-forward" size={16} color="#241505" />
                    </>
                  )}
                </Pressable>
              </View>
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
                      Enter a code from your friend
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
        ? 'rgba(255, 186, 102, 0.35)'
        : i % 3 === 1
          ? 'rgba(255, 140, 60, 0.3)'
          : 'rgba(255, 206, 132, 0.3)',
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

// ─── Google sign-in pill ─────────────────────────────────────────────
function AuthPill() {
  const session = useAuthStore((s) => s.session);
  const profile = useAuthStore((s) => s.profile);
  const loading = useAuthStore((s) => s.loading);
  const signOut = useAuthStore((s) => s.signOut);

  const handlePress = async () => {
    if (session) {
      Alert.alert(
        profile?.display_name ?? 'Interlude Player',
        'Signed in with Google',
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Sign out',
            style: 'destructive',
            onPress: async () => {
              await signOut();
              router.replace('/login');
            },
          },
        ]
      );
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
        <Text style={styles.authName} numberOfLines={1} ellipsizeMode="tail">
          {profile.display_name ?? 'You'}
        </Text>
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
    backgroundColor: '#140b04',
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
    backgroundColor: 'rgba(30, 14, 5, 0.7)',
    borderWidth: 1,
    borderColor: 'rgba(255, 190, 110, 0.28)',
    borderRadius: BorderRadius.full,
    paddingHorizontal: 10,
    marginLeft: 8,
  },
  authAvatar: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: 'rgba(255, 190, 110, 0.14)',
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
    fontSize: 48,
    color: '#ffffff',
    letterSpacing: 2,
    textTransform: 'uppercase',
    lineHeight: 52,
    textShadowColor: 'rgba(30, 10, 2, 0.95)',
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
    textShadowColor: 'rgba(30, 10, 2, 0.95)',
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

  // Create / Invite
  chooseLabel: {
    fontFamily: 'Inter-Bold',
    fontSize: 15,
    color: Colors.primary,
  },
  chooseHint: {
    fontFamily: 'Inter',
    fontSize: 13,
    color: Colors.textMuted,
    marginTop: 2,
    marginBottom: Spacing.md,
  },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
    borderRadius: BorderRadius.md,
    borderWidth: 1,
    borderColor: Colors.glassBorder,
    paddingHorizontal: Spacing.md,
    paddingVertical: 10,
    marginBottom: Spacing.md,
  },
  searchInput: {
    flex: 1,
    fontFamily: 'Inter',
    fontSize: 15,
    color: Colors.primary,
    padding: 0,
  },
  resultList: {
    gap: Spacing.sm,
    marginBottom: Spacing.md,
  },
  resultRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    paddingVertical: 6,
    paddingHorizontal: Spacing.sm,
    borderRadius: BorderRadius.md,
  },
  resultRowActive: {
    backgroundColor: 'rgba(255, 190, 110, 0.1)',
  },
  resultImage: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: Colors.surfaceContainer,
  },
  resultImagePlaceholder: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.surfaceContainer,
  },
  resultName: {
    flex: 1,
    fontFamily: 'Inter-Bold',
    fontSize: 15,
    color: Colors.primary,
  },
  searchStatus: {
    fontFamily: 'Inter',
    fontSize: 13,
    color: Colors.textSubtle,
    textAlign: 'center',
    marginBottom: Spacing.md,
  },
  chosenRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    backgroundColor: 'rgba(255, 190, 110, 0.08)',
    borderRadius: BorderRadius.lg,
    borderWidth: 1,
    borderColor: 'rgba(255, 190, 110, 0.2)',
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.sm,
    marginBottom: Spacing.md,
  },
  chosenImage: {
    width: 54,
    height: 54,
    borderRadius: 27,
    backgroundColor: Colors.surfaceContainer,
  },
  chosenText: {
    flex: 1,
    minWidth: 0,
    paddingRight: Spacing.xs,
  },
  chosenLabel: {
    fontFamily: 'Inter',
    fontSize: 10,
    color: WARM_GOLD,
    textTransform: 'uppercase',
    letterSpacing: 1.2,
    marginBottom: 2,
  },
  chosenName: {
    fontFamily: 'Inter-Bold',
    fontSize: 16,
    lineHeight: 21,
    color: Colors.primary,
  },
  noArtistRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    backgroundColor: 'rgba(255, 190, 110, 0.06)',
    borderRadius: BorderRadius.lg,
    borderWidth: 1,
    borderColor: 'rgba(255, 190, 110, 0.18)',
    borderStyle: 'dashed',
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.sm,
    marginBottom: Spacing.md,
  },
  noArtistIcon: {
    width: 54,
    height: 54,
    borderRadius: 27,
    backgroundColor: 'rgba(255, 190, 110, 0.1)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  noArtistHint: {
    fontFamily: 'Inter',
    fontSize: 13,
    color: Colors.textMuted,
    marginTop: 2,
  },
  changeButton: {
    flexDirection: 'row',
    alignSelf: 'center',
    alignItems: 'center',
    gap: 5,
    backgroundColor: 'rgba(255, 190, 110, 0.16)',
    borderRadius: BorderRadius.full,
    paddingHorizontal: 14,
    paddingVertical: 9,
  },
  changeButtonText: {
    fontFamily: 'Inter-Bold',
    fontSize: 13,
    color: WARM_GOLD_BRIGHT,
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    marginBottom: Spacing.lg,
  },
  inviteHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    marginBottom: Spacing.md,
  },
  inviteIconRing: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: 'rgba(255, 190, 110, 0.3)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  inviteHeaderText: {
    flex: 1,
  },
  inviteLabel: {
    fontFamily: 'Inter-Bold',
    fontSize: 15,
    color: Colors.primary,
    marginBottom: 2,
  },
  inviteHint: {
    fontFamily: 'Inter',
    fontSize: 13,
    color: Colors.textMuted,
  },
  linkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 190, 110, 0.08)',
    borderRadius: BorderRadius.md,
    borderWidth: 1,
    borderColor: 'rgba(255, 190, 110, 0.2)',
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    marginBottom: Spacing.lg,
  },
  linkText: {
    flex: 1,
    fontFamily: 'Inter',
    fontSize: 14,
    color: WARM_GOLD_BRIGHT,
    letterSpacing: 0.3,
  },
  linkLoading: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  linkLoadingText: {
    fontFamily: 'Inter',
    fontSize: 13,
    color: Colors.textMuted,
    flexShrink: 1,
  },
  buttonMuted: {
    opacity: 0.4,
  },
  copyButton: {
    paddingLeft: Spacing.sm,
  },
  inviteButtonsRow: {
    flexDirection: 'row',
    gap: Spacing.sm,
  },
  shareButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.xs,
    backgroundColor: 'rgba(255, 190, 110, 0.18)',
    borderRadius: BorderRadius.lg,
    paddingVertical: 14,
  },
  shareButtonText: {
    fontFamily: 'Inter-Bold',
    fontSize: 15,
    color: WARM_GOLD_BRIGHT,
  },
  startButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.xs,
    backgroundColor: WARM_GOLD,
    borderRadius: BorderRadius.lg,
    paddingVertical: 14,
  },
  startButtonText: {
    fontFamily: 'Inter-Bold',
    fontSize: 15,
    color: '#241505',
  },
  startButtonDisabled: {
    opacity: 0.35,
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