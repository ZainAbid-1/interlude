import React from 'react';
import { View, StyleSheet, ViewProps } from 'react-native';
import { BlurView } from 'expo-blur';
import { Colors, BorderRadius } from '../constants/theme';

interface GlassCardProps extends ViewProps {
  children: React.ReactNode;
  borderRadius?: number;
  intensity?: number;
  padding?: number;
}

/**
 * Glassmorphism card component using expo-blur.
 * Provides frosted-glass effect with semi-transparent border.
 */
export function GlassCard({
  children,
  borderRadius = BorderRadius.xl,
  intensity = 40,
  padding = 24,
  style,
  ...props
}: GlassCardProps) {
  return (
    <View
      style={[
        styles.container,
        {
          borderRadius,
          overflow: 'hidden',
        },
        style,
      ]}
      {...props}
    >
      <BlurView
        intensity={intensity}
        tint="dark"
        style={[StyleSheet.absoluteFill]}
      />
      <View style={[styles.overlay, { borderRadius }]} />
      <View style={[styles.border, { borderRadius }]} />
      <View style={[{ padding }, style && 'flex' in style ? { flex: (style as any).flex } : undefined]}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'relative',
  },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: Colors.glassBg,
  },
  border: {
    ...StyleSheet.absoluteFillObject,
    borderWidth: 1,
    borderColor: Colors.glassBorder,
  },
});
