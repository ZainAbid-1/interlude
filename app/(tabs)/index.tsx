import React, { useState, useEffect, useRef } from 'react';
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
import {
  getTopArtists,
  searchArtists,
  FALLBACK_TOP_ARTISTS,
} from '../../services/spotify';
import type { SpotifyArtist } from '../../services/spotify';
import { useRoomStore } from '../../store/roomStore';
import { useGameStore } from '../../store/gameStore';
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

  const [topArtists, setTopArtists] = useState<SpotifyArtist[]>(
    FALLBACK_TOP_ARTISTS
  );
  const [chosenArtist, setChosenArtist] = useState<SpotifyArtist>(
    FALLBACK_TOP_ARTISTS[0]
  );
  const [artistQuery, setArtistQuery] = useState('');
  const [artistMatches, setArtistMatches] = useState<SpotifyArtist[]>([]);
  const [searching, setSearching] = useState(false);

  const roomCode = useRoomStore((s) => s.roomCode);
  const createRoom = useRoomStore((s) => s.createRoom);
  const joinRoom = useRoomStore((s) => s.joinRoom);
  const initGame = useGameStore((s) => s.initGame);

  // Load live Spotify top artists on mount
  useEffect(() => {
    let mounted = true;
    getTopArtists(6)
      .then((artists) => {
        if (mounted) setTopArtists(artists);
      })
      .catch(() => {});
    return () => {
      mounted = false;
    };
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

  const ensureRoom = () => {
    if (!roomCode) {
      createRoom(chosenArtist.name, chosenArtist.image);
    }
  };

  const toggleCreate = () => {
    const next = !showCreate;
    if (next) ensureRoom();
    setShowCreate(next);
  };

  const startGame = () => {
    createRoom(chosenArtist.name, chosenArtist.image);
    initGame();
    router.push('/game');
  };

  const selectArtist = (artist: SpotifyArtist) => {
    setChosenArtist(artist);
    createRoom(artist.name, artist.image);
  };

  const handleCreateArtist = (artist: { name: string; image: string }) => {
    createRoom(artist.name, artist.image);
    initGame();
    router.push('/game');
  };

  const handleJoinRoom = () => {
    if (joinCode.length === 6) {
      joinRoom(joinCode);
      initGame();
      router.push('/game');
    }
  };

  const handleShareInvite = async () => {
    ensureRoom();
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
    ensureRoom();
    await Clipboard.setStringAsync(`interlude://join/${roomCode}`);
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  };

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      {/* Spotify-aesthetic album collage background */}
      <AlbumCollageBackground />

      {/* Animated floating particles */}
      <FloatingParticles />

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
            <Text style={styles.logoText}>INTERLUDE.</Text>
          </View>
          <Text style={styles.subtitle}>
            Choose an artist. Challenge your friend. Guess the track.
          </Text>
        </Animated.View>

        {/* Popular Artists (on top), cards move slowly */}
        <Animated.View entering={FadeInDown.delay(200).duration(600)}>
          <Text style={styles.sectionTitle}>Popular Artists</Text>
          <AutoScrollingArtists
            artists={topArtists}
            onSelectArtist={handleCreateArtist}
          />
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

              <View style={styles.searchRow}>
                <Ionicons name="search" size={18} color={Colors.textSubtle} />
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

              {artistQuery.trim().length > 0 ? (
                artistMatches.length > 0 ? (
                  <View style={styles.resultList}>
                    {artistMatches.map((artist) => (
                      <Pressable
                        key={artist.id}
                        onPress={() => selectArtist(artist)}
                        style={[
                          styles.resultRow,
                          chosenArtist.id === artist.id && styles.resultRowActive,
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
                            chosenArtist.id === artist.id
                              ? 'checkmark-circle'
                              : 'chevron-forward'
                          }
                          size={18}
                          color={
                            chosenArtist.id === artist.id
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
                )
              ) : (
                <View style={styles.chosenRow}>
                  <Image
                    source={{ uri: chosenArtist.image }}
                    style={styles.chosenImage}
                  />
                  <View style={styles.chosenText}>
                    <Text style={styles.chosenLabel}>Selected artist</Text>
                    <Text style={styles.chosenName} numberOfLines={1}>
                      {chosenArtist.name}
                    </Text>
                  </View>
                </View>
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
                <Text style={styles.linkText} numberOfLines={1}>
                  interlude://join/{roomCode}
                </Text>
                <Pressable
                  onPress={handleCopyLink}
                  hitSlop={8}
                  style={styles.copyButton}
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
                  style={styles.shareButton}
                >
                  <Ionicons name="share-outline" size={16} color="#241505" />
                  <Text style={styles.shareButtonText}>Share Invite</Text>
                </Pressable>
                <Pressable onPress={startGame} style={styles.startButton}>
                  <Text style={styles.startButtonText}>Start Game</Text>
                  <Ionicons name="arrow-forward" size={16} color="#241505" />
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
                  joinCode.length < 6 && styles.joinButtonDisabled,
                ]}
                disabled={joinCode.length < 6}
              >
                <Text style={styles.joinButtonText}>Join Game</Text>
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

// ─── Auto-scrolling popular artists ───────────────────────────────────
interface ArtistItem {
  id: string;
  name: string;
  image: string;
}

function AutoScrollingArtists({
  artists,
  onSelectArtist,
}: {
  artists: ArtistItem[];
  onSelectArtist: (artist: ArtistItem) => void;
}) {
  const scrollRef = useRef<ScrollView>(null);
  const viewportWidthRef = useRef(0);
  const pausedRef = useRef(false);
  const [maxScroll, setMaxScroll] = useState(0);

  useEffect(() => {
    if (maxScroll <= 0) return;

    let x = maxScroll;
    let dir = -1;
    const step = 0.45;
    const id = setInterval(() => {
      if (pausedRef.current) return;
      x += dir * step;
      if (x >= maxScroll) {
        x = maxScroll;
        dir = -1;
      } else if (x <= 0) {
        x = 0;
        dir = 1;
      }
      scrollRef.current?.scrollTo({ x, y: 0, animated: false });
    }, 16);

    return () => clearInterval(id);
  }, [maxScroll]);

  return (
    <View
      style={styles.artistsWrap}
      onLayout={(e) => {
        viewportWidthRef.current = e.nativeEvent.layout.width;
      }}
    >
      <ScrollView
        ref={scrollRef}
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.artistsScroll}
        onContentSizeChange={(w) => {
          const max = Math.max(0, w - viewportWidthRef.current);
          setMaxScroll(max);
        }}
        onScrollBeginDrag={() => {
          pausedRef.current = true;
        }}
        onScrollEndDrag={() => {
          pausedRef.current = false;
        }}
      >
        {artists.map((artist) => (
          <Pressable
            key={artist.id}
            onPress={() => onSelectArtist(artist)}
          >
            <View style={styles.artistCard}>
              <Image source={{ uri: artist.image }} style={styles.artistImage} />
              <View style={styles.artistOverlay}>
                <Text style={styles.artistName} numberOfLines={1}>
                  {artist.name}
                </Text>
              </View>
            </View>
          </Pressable>
        ))}
      </ScrollView>
</View>
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
    gap: Spacing.sm,
    marginBottom: Spacing.xs,
  },
  logoText: {
    fontFamily: 'Antonio',
    fontSize: 48,
    color: '#ffffff',
    letterSpacing: 4,
    textTransform: 'uppercase',
    lineHeight: 52,
    textShadowColor: 'rgba(30, 10, 2, 0.95)',
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 8,
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

  // Popular Artists
  sectionTitle: {
    fontFamily: 'Inter-Bold',
    fontSize: 18,
    color: WARM_GOLD,
    marginTop: Spacing.sm,
    marginBottom: Spacing.xs,
  },
  artistsWrap: {
    overflow: 'hidden',
  },
  artistsScroll: {
    gap: Spacing.stackGap,
    paddingRight: Spacing.containerPadding,
    marginTop: 0,
  },
  artistCard: {
    width: 130,
    height: 160,
    borderRadius: BorderRadius.lg,
    overflow: 'hidden',
    backgroundColor: Colors.surfaceContainer,
  },
  artistImage: {
    width: '100%',
    height: '100%',
    resizeMode: 'cover',
  },
  artistOverlay: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    padding: Spacing.sm,
    paddingTop: 24,
    backgroundColor: 'transparent',
  },
  artistName: {
    fontFamily: 'Inter-Bold',
    fontSize: 13,
    color: Colors.primary,
    textShadowColor: 'rgba(0,0,0,0.8)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 4,
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
    gap: Spacing.md,
    backgroundColor: 'rgba(255, 190, 110, 0.08)',
    borderRadius: BorderRadius.lg,
    borderWidth: 1,
    borderColor: 'rgba(255, 190, 110, 0.2)',
    padding: Spacing.md,
    marginBottom: Spacing.md,
  },
  chosenImage: {
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: Colors.surfaceContainer,
  },
  chosenText: {
    flex: 1,
  },
  chosenLabel: {
    fontFamily: 'Inter',
    fontSize: 12,
    color: WARM_GOLD,
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: 2,
  },
  chosenName: {
    fontFamily: 'Inter-Bold',
    fontSize: 16,
    color: Colors.primary,
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