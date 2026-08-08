import React, { useEffect, useMemo } from 'react';
import { View, Image, StyleSheet, Dimensions } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withSequence,
  withTiming,
  withDelay,
  Easing,
  interpolate,
} from 'react-native-reanimated';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

// Album art images from Spotify CDN — diverse, colorful covers
const ALBUM_COVERS = [
  'https://i.scdn.co/image/ab67616d0000b273ff9ca10b55ce82ae553c8228', // After Hours - The Weeknd
  'https://i.scdn.co/image/ab67616d0000b2739e1cfc756886ac782e363d79', // Currents - Tame Impala
  'https://i.scdn.co/image/ab67616d0000b27317b3850ed5ea8e7c9f659c3b', // Starboy - The Weeknd
  'https://i.scdn.co/image/ab67616d0000b2734121faee8df82c526cbab2be', // AM - Arctic Monkeys
  'https://i.scdn.co/image/ab67616d0000b2731dacfbc31cc873d132958af9', // In Rainbows - Radiohead
  'https://i.scdn.co/image/ab67616d0000b273b1c4b76e23414c9f20242268', // Random Access Memories - Daft Punk
  'https://i.scdn.co/image/ab67616d0000b273e8b066f70c206551210d902b', // Blonde - Frank Ocean
  'https://i.scdn.co/image/ab67616d0000b2738b52c6b9bc4e43d873869699', // ASTROWORLD - Travis Scott
  'https://i.scdn.co/image/ab67616d0000b273879e9318cb9f4e05ee552ac9', // Blinding Lights Single
  'https://i.scdn.co/image/ab67616d0000b2732df01971eb61f14fd8d518ed', // Dark Side of the Moon
  'https://i.scdn.co/image/ab67616d0000b273d9985092cd88bffd97653b58', // Nevermind - Nirvana
  'https://i.scdn.co/image/ab67616d0000b27354e544672baa16145d67612b', // Igor - Tyler the Creator
  'https://i.scdn.co/image/ab67616d0000b273c5649add07ed3720be9d5526', // Kids See Ghosts
  'https://i.scdn.co/image/ab67616d0000b2730dcf0e3ce3c1a794e4b9c746', // To Pimp a Butterfly
  'https://i.scdn.co/image/ab67616d0000b2736c7112082b63beefffe40151', // Melodrama - Lorde
  'https://i.scdn.co/image/ab67616d0000b273712701c5e263efc8726b1464', // Discovery - Daft Punk
  'https://i.scdn.co/image/ab67616d0000b273407981084d79d283e24d428e', // Euphoria OST
  'https://i.scdn.co/image/ab67616d0000b273a91c10fe9472d9bd535f37b5', // Lonerism - Tame Impala
  'https://i.scdn.co/image/ab67616d0000b273ba5db46f4b838ef6027e6f96', // OK Computer - Radiohead
  'https://i.scdn.co/image/ab67616d0000b2734718e2b124f79258be7571c1', // Homework - Daft Punk
];

// Card configuration for a scattered collage look
interface CardConfig {
  x: number;
  y: number;
  rotation: number;
  scale: number;
  albumIndex: number;
  animDelay: number;
  driftX: number;
  driftY: number;
  driftDuration: number;
}

function generateCards(): CardConfig[] {
  // Deterministic "random" positions for a beautiful collage layout
  const cards: CardConfig[] = [
    // Row 1 - top area
    { x: -30, y: -40, rotation: -12, scale: 0.85, albumIndex: 0, animDelay: 0, driftX: 3, driftY: 4, driftDuration: 4000 },
    { x: 80, y: -20, rotation: 8, scale: 0.75, albumIndex: 1, animDelay: 200, driftX: -2, driftY: 3, driftDuration: 5000 },
    { x: 200, y: -50, rotation: -5, scale: 0.9, albumIndex: 2, animDelay: 400, driftX: 4, driftY: -2, driftDuration: 3500 },
    { x: 310, y: -30, rotation: 15, scale: 0.7, albumIndex: 3, animDelay: 100, driftX: -3, driftY: 5, driftDuration: 4500 },

    // Row 2
    { x: -20, y: 90, rotation: 6, scale: 0.78, albumIndex: 4, animDelay: 300, driftX: 2, driftY: -3, driftDuration: 5500 },
    { x: 110, y: 110, rotation: -10, scale: 0.88, albumIndex: 5, animDelay: 500, driftX: -4, driftY: 2, driftDuration: 4200 },
    { x: 240, y: 80, rotation: 12, scale: 0.82, albumIndex: 6, animDelay: 150, driftX: 3, driftY: -4, driftDuration: 3800 },
    { x: 350, y: 100, rotation: -7, scale: 0.7, albumIndex: 7, animDelay: 600, driftX: -2, driftY: 3, driftDuration: 4800 },

    // Row 3
    { x: -40, y: 220, rotation: -15, scale: 0.92, albumIndex: 8, animDelay: 250, driftX: 4, driftY: 2, driftDuration: 3200 },
    { x: 70, y: 250, rotation: 5, scale: 0.72, albumIndex: 9, animDelay: 350, driftX: -3, driftY: -2, driftDuration: 5200 },
    { x: 190, y: 210, rotation: -8, scale: 0.85, albumIndex: 10, animDelay: 700, driftX: 2, driftY: 4, driftDuration: 4600 },
    { x: 320, y: 240, rotation: 10, scale: 0.78, albumIndex: 11, animDelay: 450, driftX: -4, driftY: -3, driftDuration: 3600 },

    // Row 4
    { x: -10, y: 360, rotation: 9, scale: 0.8, albumIndex: 12, animDelay: 550, driftX: 3, driftY: -2, driftDuration: 4400 },
    { x: 130, y: 380, rotation: -13, scale: 0.9, albumIndex: 13, animDelay: 100, driftX: -2, driftY: 4, driftDuration: 5100 },
    { x: 260, y: 350, rotation: 7, scale: 0.75, albumIndex: 14, animDelay: 650, driftX: 4, driftY: -3, driftDuration: 3400 },
    { x: 370, y: 370, rotation: -11, scale: 0.83, albumIndex: 15, animDelay: 200, driftX: -3, driftY: 2, driftDuration: 4900 },

    // Row 5 - bottom area
    { x: -30, y: 490, rotation: -6, scale: 0.88, albumIndex: 16, animDelay: 400, driftX: 2, driftY: 3, driftDuration: 5300 },
    { x: 100, y: 520, rotation: 14, scale: 0.76, albumIndex: 17, animDelay: 300, driftX: -4, driftY: -2, driftDuration: 3700 },
    { x: 230, y: 480, rotation: -9, scale: 0.82, albumIndex: 18, animDelay: 750, driftX: 3, driftY: 4, driftDuration: 4300 },
    { x: 350, y: 510, rotation: 6, scale: 0.7, albumIndex: 19, animDelay: 500, driftX: -2, driftY: -3, driftDuration: 5000 },

    // Extra cards for density
    { x: 40, y: 620, rotation: 11, scale: 0.85, albumIndex: 0, animDelay: 200, driftX: 3, driftY: 2, driftDuration: 4100 },
    { x: 170, y: 650, rotation: -8, scale: 0.78, albumIndex: 3, animDelay: 400, driftX: -3, driftY: 4, driftDuration: 3900 },
    { x: 300, y: 630, rotation: 13, scale: 0.9, albumIndex: 6, animDelay: 600, driftX: 2, driftY: -2, driftDuration: 4700 },
    { x: -20, y: 750, rotation: -10, scale: 0.73, albumIndex: 9, animDelay: 350, driftX: -4, driftY: 3, driftDuration: 5400 },
    { x: 120, y: 780, rotation: 7, scale: 0.86, albumIndex: 12, animDelay: 550, driftX: 3, driftY: -4, driftDuration: 3300 },
    { x: 260, y: 760, rotation: -14, scale: 0.8, albumIndex: 15, animDelay: 150, driftX: -2, driftY: 2, driftDuration: 4500 },
  ];

  return cards;
}

const CARD_SIZE = 120;

function FloatingCard({ config }: { config: CardConfig }) {
  const drift = useSharedValue(0);
  const pulse = useSharedValue(0);

  useEffect(() => {
    // Gentle floating drift
    drift.value = withDelay(
      config.animDelay,
      withRepeat(
        withSequence(
          withTiming(1, {
            duration: config.driftDuration,
            easing: Easing.inOut(Easing.sin),
          }),
          withTiming(0, {
            duration: config.driftDuration,
            easing: Easing.inOut(Easing.sin),
          })
        ),
        -1,
        true
      )
    );

    // Very subtle scale pulse
    pulse.value = withDelay(
      config.animDelay + 500,
      withRepeat(
        withSequence(
          withTiming(1, { duration: 3000, easing: Easing.inOut(Easing.ease) }),
          withTiming(0, { duration: 3000, easing: Easing.inOut(Easing.ease) })
        ),
        -1,
        true
      )
    );
  }, []);

  const animatedStyle = useAnimatedStyle(() => {
    const translateX = interpolate(drift.value, [0, 1], [0, config.driftX]);
    const translateY = interpolate(drift.value, [0, 1], [0, config.driftY]);
    const scaleOffset = interpolate(pulse.value, [0, 1], [0, 0.03]);

    return {
      transform: [
        { translateX },
        { translateY },
        { rotate: `${config.rotation}deg` },
        { scale: config.scale + scaleOffset },
      ],
    };
  });

  return (
    <Animated.View
      style={[
        styles.card,
        {
          left: config.x,
          top: config.y,
          width: CARD_SIZE,
          height: CARD_SIZE,
        },
        animatedStyle,
      ]}
    >
      <Image
        source={{ uri: ALBUM_COVERS[config.albumIndex] }}
        style={styles.albumImage}
      />
      {/* Mini player UI overlay */}
      <View style={styles.playerOverlay}>
        <View style={styles.playerDot} />
        <View style={styles.playerProgress}>
          <View style={styles.playerProgressFill} />
        </View>
      </View>
    </Animated.View>
  );
}

export function AlbumCollageBackground() {
  const cards = useMemo(() => generateCards(), []);

  return (
    <View style={styles.container} pointerEvents="none">
      {/* Base dark gradient */}
      <LinearGradient
        colors={['#0d0613', '#0a0a14', '#0e0818', '#080810']}
        locations={[0, 0.3, 0.6, 1]}
        style={StyleSheet.absoluteFill}
      />

      {/* Album cards */}
      <View style={styles.cardsContainer}>
        {cards.map((config, index) => (
          <FloatingCard key={index} config={config} />
        ))}
      </View>

      {/* Color mood overlays */}
      <View style={styles.purpleGlow1} />
      <View style={styles.purpleGlow2} />
      <View style={styles.pinkGlow} />
      <View style={styles.blueGlow} />

      {/* Dark vignette overlays for readability */}
      <LinearGradient
        colors={[
          'rgba(10, 6, 18, 0.3)',
          'rgba(10, 6, 18, 0.6)',
          'rgba(10, 6, 18, 0.85)',
          'rgba(10, 6, 18, 0.95)',
        ]}
        locations={[0, 0.25, 0.6, 1]}
        style={StyleSheet.absoluteFill}
      />

      {/* Top fade for status bar */}
      <LinearGradient
        colors={['rgba(10, 6, 18, 0.95)', 'rgba(10, 6, 18, 0.4)', 'transparent']}
        locations={[0, 0.4, 1]}
        style={styles.topFade}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    ...StyleSheet.absoluteFillObject,
    overflow: 'hidden',
  },
  cardsContainer: {
    ...StyleSheet.absoluteFillObject,
  },
  card: {
    position: 'absolute',
    borderRadius: 10,
    overflow: 'hidden',
    // Subtle glow shadow
    shadowColor: '#a855f7',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 12,
    elevation: 8,
  },
  albumImage: {
    width: '100%',
    height: '100%',
    resizeMode: 'cover',
  },
  playerOverlay: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    paddingHorizontal: 8,
    paddingBottom: 6,
    paddingTop: 16,
    backgroundColor: 'rgba(0, 0, 0, 0.55)',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  playerDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: 'rgba(255, 255, 255, 0.7)',
  },
  playerProgress: {
    flex: 1,
    height: 2,
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    borderRadius: 1,
  },
  playerProgressFill: {
    width: '60%',
    height: '100%',
    backgroundColor: 'rgba(255, 255, 255, 0.6)',
    borderRadius: 1,
  },
  purpleGlow1: {
    position: 'absolute',
    top: '15%',
    left: '-10%',
    width: 300,
    height: 300,
    borderRadius: 150,
    backgroundColor: 'rgba(139, 92, 246, 0.12)',
  },
  purpleGlow2: {
    position: 'absolute',
    bottom: '25%',
    right: '-15%',
    width: 350,
    height: 350,
    borderRadius: 175,
    backgroundColor: 'rgba(168, 85, 247, 0.08)',
  },
  pinkGlow: {
    position: 'absolute',
    top: '40%',
    right: '10%',
    width: 200,
    height: 200,
    borderRadius: 100,
    backgroundColor: 'rgba(236, 72, 153, 0.07)',
  },
  blueGlow: {
    position: 'absolute',
    bottom: '10%',
    left: '20%',
    width: 250,
    height: 250,
    borderRadius: 125,
    backgroundColor: 'rgba(59, 130, 246, 0.05)',
  },
  topFade: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 120,
  },
});
