import React, { useEffect } from 'react';
import { View, StyleSheet } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  Easing,
  runOnJS,
} from 'react-native-reanimated';
import { Colors, BorderRadius } from '../constants/theme';

interface ProgressBarProps {
  /** Duration in milliseconds */
  duration: number;
  /** Whether the bar is actively counting down */
  isActive: boolean;
  /** Callback when the timer completes */
  onComplete?: () => void;
  /** Height of the bar */
  height?: number;
}

/**
 * Animated progress bar that fills from 0 to 100% over the given duration.
 * Uses Reanimated for UI-thread animation.
 */
export function ProgressBar({
  duration,
  isActive,
  onComplete,
  height = 4,
}: ProgressBarProps) {
  const progress = useSharedValue(0);

  useEffect(() => {
    if (isActive) {
      progress.value = 0;
      progress.value = withTiming(
        1,
        {
          duration,
          easing: Easing.linear,
        },
        (finished) => {
          if (finished && onComplete) {
            runOnJS(onComplete)();
          }
        }
      );
    } else {
      progress.value = 0;
    }
  }, [isActive, duration]);

  const animatedStyle = useAnimatedStyle(() => ({
    width: `${progress.value * 100}%`,
  }));

  return (
    <View style={[styles.track, { height }]}>
      <Animated.View style={[styles.fill, { height }, animatedStyle]} />
    </View>
  );
}

const styles = StyleSheet.create({
  track: {
    width: '100%',
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    borderRadius: BorderRadius.full,
    overflow: 'hidden',
  },
  fill: {
    backgroundColor: '#ffffff',
    borderRadius: BorderRadius.full,
  },
});
