import React, { useEffect } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Animated, {
  interpolateColor,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { haptic } from '../lib/haptics';

/**
 * On/off switch in the iPhone style, the same on every phone: a green pill
 * when on, grey when off, with a white knob that slides across.
 */
const TRACK_W = 51;
const TRACK_H = 31;
const KNOB = 27;
const PAD = 2;
const ON = '#34C759';
const OFF = 'rgba(120, 120, 128, 0.36)';

export function ToggleSwitch({
  value,
  onValueChange,
  disabled,
  accessibilityLabel,
  decorative,
}: {
  value: boolean;
  onValueChange?: (next: boolean) => void;
  disabled?: boolean;
  accessibilityLabel?: string;
  /** Show the state only; the surrounding row handles taps and announcing. */
  decorative?: boolean;
}) {
  const progress = useSharedValue(value ? 1 : 0);

  useEffect(() => {
    progress.value = withTiming(value ? 1 : 0, { duration: 200 });
  }, [value, progress]);

  const trackStyle = useAnimatedStyle(() => ({
    backgroundColor: interpolateColor(progress.value, [0, 1], [OFF, ON]),
  }));
  const knobStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: progress.value * (TRACK_W - KNOB - PAD * 2) }],
  }));

  const toggle = () => {
    if (disabled || !onValueChange) return;
    haptic.select();
    onValueChange(!value);
  };

  const visual = (
    <View style={disabled ? styles.disabled : undefined}>
      <Animated.View style={[styles.track, trackStyle]}>
        <Animated.View style={[styles.knob, knobStyle]} />
      </Animated.View>
    </View>
  );

  // Inside a row that handles the tap itself, it's only a picture of the state.
  if (decorative) {
    return (
      <View pointerEvents="none" accessible={false} importantForAccessibility="no-hide-descendants">
        {visual}
      </View>
    );
  }

  return (
    <Pressable
      onPress={toggle}
      disabled={disabled}
      hitSlop={8}
      accessibilityRole="switch"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ checked: value, disabled: !!disabled }}
    >
      {visual}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  track: {
    width: TRACK_W,
    height: TRACK_H,
    borderRadius: TRACK_H / 2,
    padding: PAD,
    justifyContent: 'center',
  },
  knob: {
    width: KNOB,
    height: KNOB,
    borderRadius: KNOB / 2,
    backgroundColor: '#ffffff',
    shadowColor: '#000',
    shadowOpacity: 0.25,
    shadowRadius: 3,
    shadowOffset: { width: 0, height: 2 },
    elevation: 3,
  },
  disabled: {
    opacity: 0.5,
  },
});
