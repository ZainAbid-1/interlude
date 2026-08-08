import React from 'react';
import {
  Pressable,
  Text,
  StyleSheet,
  ViewStyle,
} from 'react-native';
import { BlurView } from 'expo-blur';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { Colors, BorderRadius } from '../constants/theme';

type AnswerState = 'default' | 'selected' | 'correct' | 'incorrect' | 'dimmed';

interface AnswerButtonProps {
  label: string;
  state: AnswerState;
  onPress: () => void;
  disabled?: boolean;
}

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

/**
 * Glass-styled answer button with press animation and state-based coloring.
 */
export function AnswerButton({
  label,
  state,
  onPress,
  disabled = false,
}: AnswerButtonProps) {
  const scale = useSharedValue(1);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  const handlePressIn = () => {
    scale.value = withSpring(0.95, { damping: 15, stiffness: 300 });
  };

  const handlePressOut = () => {
    scale.value = withSpring(1, { damping: 15, stiffness: 300 });
  };

  const stateStyles = getStateStyles(state);

  return (
    <AnimatedPressable
      onPress={onPress}
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
      disabled={disabled}
      style={[animatedStyle, styles.wrapper]}
    >
      <BlurView
        intensity={30}
        tint="dark"
        style={[StyleSheet.absoluteFill, { borderRadius: BorderRadius.lg }]}
      />
      <Animated.View
        style={[
          styles.button,
          stateStyles.container,
        ]}
      >
        <Text
          style={[styles.label, stateStyles.text]}
          numberOfLines={2}
          adjustsFontSizeToFit
          minimumFontScale={0.7}
        >
          {label}
        </Text>
      </Animated.View>
    </AnimatedPressable>
  );
}

function getStateStyles(state: AnswerState): {
  container: ViewStyle;
  text: { color: string };
} {
  switch (state) {
    case 'correct':
      return {
        container: {
          backgroundColor: Colors.correctBg,
          borderColor: Colors.correct,
        },
        text: { color: Colors.correct },
      };
    case 'incorrect':
      return {
        container: {
          backgroundColor: Colors.incorrectBg,
          borderColor: Colors.incorrect,
        },
        text: { color: Colors.incorrect },
      };
    case 'selected':
      return {
        container: {
          backgroundColor: 'rgba(255, 255, 255, 0.12)',
          borderColor: 'rgba(255, 255, 255, 0.3)',
        },
        text: { color: '#ffffff' },
      };
    case 'dimmed':
      return {
        container: {
          backgroundColor: Colors.glassBg,
          borderColor: Colors.glassBorderSubtle,
          opacity: 0.5,
        },
        text: { color: Colors.textMuted },
      };
    default:
      return {
        container: {
          backgroundColor: Colors.glassBg,
          borderColor: Colors.glassBorderSubtle,
        },
        text: { color: '#ffffff' },
      };
  }
}

const styles = StyleSheet.create({
  wrapper: {
    flex: 1,
    borderRadius: BorderRadius.lg,
    overflow: 'hidden',
  },
  button: {
    paddingVertical: 22,
    paddingHorizontal: 16,
    borderRadius: BorderRadius.lg,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 70,
  },
  label: {
    fontFamily: 'Inter',
    fontSize: 15,
    fontWeight: '500',
    textAlign: 'center',
  },
});
