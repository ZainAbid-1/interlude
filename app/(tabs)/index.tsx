import React, { useState, useRef, useEffect } from 'react';
import {
  View,
  Text,
  ScrollView,
  Pressable,
  StyleSheet,
  Dimensions,
  Image,
  TextInput,
  Share,
  Platform,
} from 'react-native';
import { router } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { BlurView } from 'expo-blur';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  withRepeat,
  withSequence,
  withTiming,
  withDelay,
  FadeIn,
  FadeInDown,
  FadeInUp,
  SlideInUp,
  Easing,
  interpolate,
} from 'react-native-reanimated';
import { MaterialCommunityIcons, Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { GlassCard } from '../../components/GlassCard';
import { AlbumCollageBackground } from '../../components/AlbumCollageBackground';
import { RoomCodeInput } from '../../components/RoomCodeInput';
import { useRoomStore } from '../../store/roomStore';
import { useGameStore } from '../../store/gameStore';
import { Colors, Spacing, BorderRadius, Typography } from '../../constants/theme';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');
const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

export default function HomeScreen() {
  const insets = useSafeAreaInsets();
  const [joinCode, setJoinCode] = useState('');
  const [showJoinInput, setShowJoinInput] = useState(false);
  const createRoom = useRoomStore((s) => s.createRoom);
  const initGame = useGameStore((s) => s.initGame);



  const handleCreateRoom = () => {
    createRoom(
      'Radiohead',
      'https://i.scdn.co/image/ab6761610000e5eba03696716c9ee605006047fd'
    );
    initGame();
    router.push('/game');
  };

  const handleJoinRoom = () => {
    if (joinCode.length === 6) {
      initGame();
      router.push('/game');
    }
  };

  const handleShareInvite = async () => {
    try {
      await Share.share({
        message: `Join my Interlude room! Code: RHXQ42\n\nPlay now: interlude://join/RHXQ42`,
        title: 'Join my Interlude game!',
      });
    } catch (e) {
      // Silently handle
    }
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

        {/* Create Room */}
        <Animated.View entering={FadeInDown.delay(350).duration(600)}>
          <AnimatedPressable onPress={handleCreateRoom}>
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
                      Pick an artist and invite a friend
                    </Text>
                  </View>
                </View>
                <Ionicons
                  name="chevron-forward"
                  size={20}
                  color={Colors.textSubtle}
                />
              </View>
            </GlassCard>
          </AnimatedPressable>
        </Animated.View>

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

        {/* Invite Section */}
        <Animated.View entering={FadeInDown.delay(550).duration(600)}>
          <Pressable onPress={handleShareInvite}>
            <GlassCard borderRadius={24} padding={0}>
              <View style={styles.inviteCard}>
                <View style={styles.inviteLeft}>
                  <View style={styles.inviteIconRing}>
                    <Ionicons
                      name="share-outline"
                      size={22}
                      color={Colors.primary}
                    />
                  </View>
                  <View>
                    <Text style={styles.inviteTitle}>Invite a Friend</Text>
                    <Text style={styles.inviteDesc}>
                      Share a link to start playing
                    </Text>
                  </View>
                </View>
                <View style={styles.inviteBadge}>
                  <Text style={styles.inviteBadgeText}>Share</Text>
                </View>
              </View>
            </GlassCard>
          </Pressable>
        </Animated.View>

        {/* Quick Match Suggestion */}
        <Animated.View entering={FadeInDown.delay(650).duration(600)}>
          <Text style={styles.sectionTitle}>Popular Artists</Text>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.artistsScroll}
          >
            {POPULAR_ARTISTS.map((artist, index) => (
              <Animated.View
                key={artist.name}
                entering={FadeInDown.delay(700 + index * 80).duration(400)}
              >
                <Pressable
                  onPress={() => {
                    createRoom(artist.name, artist.image);
                    initGame();
                    router.push('/game');
                  }}
                >
                  <View style={styles.artistCard}>
                    <Image
                      source={{ uri: artist.image }}
                      style={styles.artistImage}
                    />
                    <View style={styles.artistOverlay}>
                      <Text style={styles.artistName} numberOfLines={1}>
                        {artist.name}
                      </Text>
                    </View>
                  </View>
                </Pressable>
              </Animated.View>
            ))}
          </ScrollView>
        </Animated.View>
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
        ? 'rgba(168, 85, 247, 0.4)'
        : i % 3 === 1
          ? 'rgba(236, 72, 153, 0.3)'
          : 'rgba(59, 130, 246, 0.3)',
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

const POPULAR_ARTISTS = [
  {
    name: 'Radiohead',
    image: 'https://i.scdn.co/image/ab6761610000e5eba03696716c9ee605006047fd',
  },
  {
    name: 'Arctic Monkeys',
    image: 'https://i.scdn.co/image/ab6761610000e5eb7da39dea0a72f581535571da',
  },
  {
    name: 'Daft Punk',
    image: 'https://i.scdn.co/image/ab6761610000e5eba7bfd7835b5c1eee0c95fa6e',
  },
  {
    name: 'Tame Impala',
    image: 'https://i.scdn.co/image/ab6761610000e5ebbe3e82e7b6abcdd0e29a5fbf',
  },
  {
    name: 'The Weeknd',
    image: 'https://i.scdn.co/image/ab6761610000e5eb214f3cf1cbe7139c1e26ffbb',
  },
];

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: '#0a0613',
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
    textShadowColor: 'rgba(0, 0, 0, 0.9)',
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

  // Invite
  inviteCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: Spacing.lg,
  },
  inviteLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
  },
  inviteIconRing: {
    width: 44,
    height: 44,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.15)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  inviteTitle: {
    fontFamily: 'Inter-Bold',
    fontSize: 15,
    color: Colors.primary,
    marginBottom: 2,
  },
  inviteDesc: {
    fontFamily: 'Inter',
    fontSize: 13,
    color: Colors.textMuted,
  },
  inviteBadge: {
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    borderRadius: BorderRadius.full,
    paddingHorizontal: 14,
    paddingVertical: 6,
  },
  inviteBadgeText: {
    fontFamily: 'Inter',
    fontSize: 12,
    color: Colors.primary,
    fontWeight: '600',
  },

  // Popular Artists
  sectionTitle: {
    fontFamily: 'Inter-Bold',
    fontSize: 18,
    color: Colors.primary,
    marginTop: Spacing.sm,
    marginBottom: Spacing.xs,
  },
  artistsScroll: {
    gap: Spacing.stackGap,
    paddingRight: Spacing.containerPadding,
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
});
