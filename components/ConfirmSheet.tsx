import React, { useEffect } from 'react';
import { View, Text, Pressable, StyleSheet, Modal } from 'react-native';
import Animated, { FadeIn, SlideInDown } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BlurView } from 'expo-blur';
import { Ionicons } from '@expo/vector-icons';
import { haptic } from '../lib/haptics';
import { Colors, Spacing, BorderRadius } from '../constants/theme';
import { useNoticeStore } from '../store/noticeStore';

/**
 * "Are you sure?" panel in the app's own style, near the thumb.
 * Tapping outside or pressing Back counts as Cancel.
 */
export function ConfirmSheet() {
  const dialog = useNoticeStore((s) => s.dialog);
  const answer = useNoticeStore((s) => s.answer);
  const insets = useSafeAreaInsets();

  useEffect(() => {
    if (dialog?.destructive) {
      haptic.warning();
    }
  }, [dialog]);

  return (
    <Modal
      visible={!!dialog}
      transparent
      animationType="none"
      statusBarTranslucent
      navigationBarTranslucent
      onRequestClose={() => answer(false)}
    >
      {dialog ? (
        <View style={styles.root}>
          <Animated.View entering={FadeIn.duration(160)} style={StyleSheet.absoluteFill}>
            <Pressable
              style={styles.backdrop}
              onPress={() => answer(false)}
              accessibilityLabel="Cancel"
              accessibilityRole="button"
            />
          </Animated.View>

          <Animated.View
            key={dialog.id}
            entering={SlideInDown.duration(240)}
            style={[styles.sheet, { paddingBottom: insets.bottom + Spacing.md }]}
            accessibilityViewIsModal
          >
            <BlurView intensity={60} tint="dark" style={StyleSheet.absoluteFill} />
            <View style={styles.sheetTint} />
            <View style={styles.handle} />

            <View
              style={[
                styles.iconWrap,
                { backgroundColor: dialog.destructive ? Colors.incorrectBg : 'rgba(255, 255, 255, 0.12)' },
              ]}
            >
              <Ionicons
                name={dialog.icon ?? (dialog.destructive ? 'warning' : 'help-circle')}
                size={26}
                color={dialog.destructive ? Colors.incorrect : '#ffffff'}
              />
            </View>

            <Text style={styles.title} accessibilityRole="header" maxFontSizeMultiplier={1.4}>
              {dialog.title}
            </Text>
            {dialog.message ? (
              <Text style={styles.message} maxFontSizeMultiplier={1.4}>
                {dialog.message}
              </Text>
            ) : null}

            <View style={styles.buttons}>
              <Pressable onPress={() => answer(true)} accessibilityRole="button">
                <View style={[styles.button, dialog.destructive ? styles.buttonDanger : styles.buttonPrimary]}>
                  <Text
                    style={dialog.destructive ? styles.buttonDangerText : styles.buttonPrimaryText}
                    maxFontSizeMultiplier={1.3}
                  >
                    {dialog.confirmLabel}
                  </Text>
                </View>
              </Pressable>
              <Pressable onPress={() => answer(false)} accessibilityRole="button">
                <View style={[styles.button, styles.buttonMuted]}>
                  <Text style={styles.buttonMutedText} maxFontSizeMultiplier={1.3}>
                    {dialog.cancelLabel ?? 'Cancel'}
                  </Text>
                </View>
              </Pressable>
            </View>
          </Animated.View>
        </View>
      ) : null}
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
  },
  sheet: {
    borderTopLeftRadius: BorderRadius.xl,
    borderTopRightRadius: BorderRadius.xl,
    overflow: 'hidden',
    borderWidth: 1,
    borderBottomWidth: 0,
    borderColor: 'rgba(255, 255, 255, 0.14)',
    paddingHorizontal: Spacing.lg,
    paddingTop: 10,
    alignItems: 'center',
  },
  sheetTint: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(15, 15, 15, 0.92)',
  },
  handle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    marginBottom: Spacing.lg,
  },
  iconWrap: {
    width: 52,
    height: 52,
    borderRadius: 26,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: Spacing.md,
  },
  title: {
    fontFamily: 'Inter-Bold',
    fontSize: 19,
    lineHeight: 25,
    color: '#ffffff',
    textAlign: 'center',
  },
  message: {
    fontFamily: 'Inter',
    fontSize: 14,
    lineHeight: 20,
    color: Colors.textSubtle,
    textAlign: 'center',
    marginTop: 6,
  },
  buttons: {
    alignSelf: 'stretch',
    gap: 10,
    marginTop: Spacing.lg,
  },
  button: {
    height: 52,
    borderRadius: 26,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.md,
  },
  buttonPrimary: {
    backgroundColor: '#ffffff',
  },
  buttonDanger: {
    backgroundColor: Colors.incorrect,
  },
  buttonMuted: {
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.16)',
  },
  buttonPrimaryText: {
    fontFamily: 'Inter-Bold',
    fontSize: 16,
    color: '#000000',
  },
  buttonDangerText: {
    fontFamily: 'Inter-Bold',
    fontSize: 16,
    color: '#1a0000',
  },
  buttonMutedText: {
    fontFamily: 'Inter-Bold',
    fontSize: 16,
    color: '#ffffff',
  },
});
