import React, { useState } from 'react';
import { View, TextInput, StyleSheet, Text } from 'react-native';
import { Colors, BorderRadius, Spacing } from '../constants/theme';

interface RoomCodeInputProps {
  value: string;
  onChange: (code: string) => void;
  maxLength?: number;
}

/**
 * Stylized 6-character room code input.
 * Each character gets its own box for a premium feel.
 */
export function RoomCodeInput({
  value,
  onChange,
  maxLength = 6,
}: RoomCodeInputProps) {
  const [isFocused, setIsFocused] = useState(false);

  const handleChange = (text: string) => {
    const cleaned = text.toUpperCase().replace(/[^A-Z0-9]/g, '');
    onChange(cleaned.slice(0, maxLength));
  };

  const chars = value.split('');

  return (
    <View style={styles.container}>
      <View style={styles.boxes}>
        {Array.from({ length: maxLength }).map((_, i) => (
          <View
            key={i}
            style={[
              styles.box,
              isFocused && i === chars.length && styles.boxActive,
              chars[i] && styles.boxFilled,
            ]}
          >
            <Text style={styles.char}>{chars[i] || ''}</Text>
          </View>
        ))}
      </View>
      <TextInput
        style={styles.hiddenInput}
        value={value}
        onChangeText={handleChange}
        onFocus={() => setIsFocused(true)}
        onBlur={() => setIsFocused(false)}
        maxLength={maxLength}
        autoCapitalize="characters"
        autoCorrect={false}
        keyboardType="default"
        caretHidden
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'relative',
    width: '100%',
  },
  boxes: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: Spacing.sm,
  },
  box: {
    width: 44,
    height: 56,
    borderRadius: BorderRadius.md,
    borderWidth: 1,
    borderColor: Colors.outlineVariant,
    backgroundColor: Colors.surfaceContainerLow,
    alignItems: 'center',
    justifyContent: 'center',
  },
  boxActive: {
    borderColor: Colors.primary,
    borderWidth: 2,
  },
  boxFilled: {
    borderColor: Colors.textSubtle,
    backgroundColor: Colors.surfaceContainer,
  },
  char: {
    fontFamily: 'Inter',
    fontSize: 20,
    fontWeight: '700',
    color: Colors.primary,
    letterSpacing: 2,
  },
  hiddenInput: {
    ...StyleSheet.absoluteFillObject,
    opacity: 0,
    fontSize: 20,
  },
});
