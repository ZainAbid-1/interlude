import React, { memo, useEffect, useMemo, useState } from 'react';
import {
  View,
  Image,
  StyleSheet,
  AccessibilityInfo,
  Platform,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withSequence,
  withTiming,
  withDelay,
  cancelAnimation,
  Easing,
  interpolate,
} from 'react-native-reanimated';
import { useIsFocused } from '@react-navigation/native';

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

// Warm the image cache once at module load so the covers are decoded on a
// background thread before any screen mounts. Rendering then hits the cache and
// never pops in — the #1 source of background jank was remote decode stutter.
for (const url of ALBUM_COVERS) {
  Image.prefetch(url).catch(() => {});
}

// Card configuration for a scattered collage look.
interface CardConfig {
  x: number;
  y: number;
  rotation: number;
  scale: number;
  albumIndex: number;
}

const CARD_SIZE = 120;

function generateCards(): CardConfig[] {
  return [
    // Row 1 - top area
    { x: -25, y: -40, rotation: -12, scale: 0.85, albumIndex: 0 },
    { x: 200, y: -50, rotation: -5, scale: 0.9, albumIndex: 2 },
    { x: 340, y: -30, rotation: 15, scale: 0.72, albumIndex: 4 },

    // Row 2
    { x: -20, y: 120, rotation: 6, scale: 0.78, albumIndex: 6 },
    { x: 150, y: 130, rotation: -9, scale: 0.88, albumIndex: 8 },
    { x: 285, y: 90, rotation: 11, scale: 0.8, albumIndex: 10 },

    // Row 3
    { x: -30, y: 290, rotation: -14, scale: 0.9, albumIndex: 12 },
    { x: 120, y: 300, rotation: 4, scale: 0.74, albumIndex: 14 },
    { x: 275, y: 270, rotation: -7, scale: 0.84, albumIndex: 16 },

    // Row 4
    { x: 40, y: 470, rotation: 8, scale: 0.8, albumIndex: 18 },
    { x: 230, y: 455, rotation: -11, scale: 0.88, albumIndex: 3 },
    { x: 330, y: 520, rotation: 12, scale: 0.7, albumIndex: 5 },
  ];
}

/**
 * A static album tile. Every per-card property (rotation/scale/position) is set
 * once and never animated, so a card costs nothing per frame. The whole collage
 * moves as a single layer instead (see AlbumCollageBackground), which is what
 * keeps 12 covers on screen without burning the UI thread.
 */
const FloatingCard = memo(function FloatingCard({
  config,
}: {
  config: CardConfig;
}) {
  return (
    <View
      style={[
        styles.card,
        {
          left: config.x,
          top: config.y,
          width: CARD_SIZE,
          height: CARD_SIZE,
          transform: [
            { rotate: `${config.rotation}deg` },
            { scale: config.scale },
          ],
        },
      ]}
    >
      <Image
        source={{ uri: ALBUM_COVERS[config.albumIndex] }}
        style={styles.albumImage}
        // Downscale at decode time on Android (iOS ignores this prop) so we
        // don't hold 12 full-res 640x640 bitmaps in memory.
        resizeMethod="resize"
        fadeDuration={0}
      />
      {/* Mini player UI overlay */}
      <View style={styles.playerOverlay}>
        <View style={styles.playerDot} />
        <View style={styles.playerProgress}>
          <View style={styles.playerProgressFill} />
        </View>
      </View>
    </View>
  );
});

export function AlbumCollageBackground() {
  const cards = useMemo(() => generateCards(), []);
  const isFocused = useIsFocused();
  const [reducedMotion, setReducedMotion] = useState(false);

  useEffect(() => {
    let mounted = true;
    AccessibilityInfo.isReduceMotionEnabled().then((value) => {
      if (mounted) setReducedMotion(value);
    });
    const subscription = AccessibilityInfo.addEventListener(
      'reduceMotionChanged',
      setReducedMotion
    );
    return () => {
      mounted = false;
      subscription.remove();
    };
  }, []);

  // A single gentle drift applied to the ONE layer that holds every cover.
  // One animation instead of N per-card animations = near-zero UI cost.
  const drift = useSharedValue(0);

  useEffect(() => {
    if (!isFocused || reducedMotion) {
      drift.value = 0;
      cancelAnimation(drift);
      return;
    }
    drift.value = withDelay(
      300,
      withRepeat(
        withSequence(
          withTiming(1, { duration: 9000, easing: Easing.inOut(Easing.sin) }),
          withTiming(0, { duration: 9000, easing: Easing.inOut(Easing.sin) })
        ),
        -1,
        true
      )
    );
  }, [isFocused, reducedMotion, drift]);

  const collageStyle = useAnimatedStyle(() => {
    const translateX = interpolate(drift.value, [0, 1], [0, 10]);
    const translateY = interpolate(drift.value, [0, 1], [0, 8]);
    return { transform: [{ translateX }, { translateY }] };
  });

  return (
    <View style={styles.container} pointerEvents="none">
      {/* Base warm dark gradient */}
      <LinearGradient
        colors={['#1a0d05', '#120a06', '#200f05', '#0e0703']}
        locations={[0, 0.3, 0.6, 1]}
        style={StyleSheet.absoluteFill}
      />

      {/* Album cards — one animated layer for the whole collage */}
      <Animated.View
        style={[styles.cardsContainer, collageStyle]}
        // Composited once into a single hardware texture so moving it never
        // re-rasterizes the 12 images underneath. Android only.
        renderToHardwareTextureAndroid={Platform.OS === 'android'}
      >
        {cards.map((config, index) => (
          <FloatingCard key={index} config={config} />
        ))}
      </Animated.View>

      {/* Color mood overlays */}
      <View style={styles.goldGlow1} />
      <View style={styles.amberGlow} />
      <View style={styles.emberGlow} />
      <View style={styles.bronzeGlow} />

      {/* Dark vignette overlays for readability */}
      <LinearGradient
        colors={[
          'rgba(14, 7, 3, 0.35)',
          'rgba(16, 8, 3, 0.6)',
          'rgba(12, 6, 2, 0.85)',
          'rgba(8, 4, 2, 0.97)',
        ]}
        locations={[0, 0.25, 0.6, 1]}
        style={StyleSheet.absoluteFill}
      />

      {/* Top fade for status bar */}
      <LinearGradient
        colors={['rgba(10, 5, 2, 0.96)', 'rgba(14, 7, 3, 0.4)', 'transparent']}
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
    backgroundColor: 'rgba(30, 14, 5, 0.5)',
    // Border instead of elevation/shadow: shadows on animated views force
    // Android to re-rasterize a hardware layer every frame (a major jank
    // source), and on iOS they are clipped by `overflow: hidden` anyway.
    borderWidth: 1,
    borderColor: 'rgba(255, 190, 110, 0.18)',
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
  goldGlow1: {
    position: 'absolute',
    top: '15%',
    left: '-10%',
    width: 300,
    height: 300,
    borderRadius: 150,
    backgroundColor: 'rgba(255, 176, 92, 0.1)',
  },
  amberGlow: {
    position: 'absolute',
    bottom: '25%',
    right: '-15%',
    width: 350,
    height: 350,
    borderRadius: 175,
    backgroundColor: 'rgba(224, 124, 48, 0.07)',
  },
  emberGlow: {
    position: 'absolute',
    top: '40%',
    right: '10%',
    width: 200,
    height: 200,
    borderRadius: 100,
    backgroundColor: 'rgba(255, 196, 120, 0.06)',
  },
  bronzeGlow: {
    position: 'absolute',
    bottom: '10%',
    left: '20%',
    width: 250,
    height: 250,
    borderRadius: 125,
    backgroundColor: 'rgba(164, 92, 40, 0.06)',
  },
  topFade: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 120,
  },
});