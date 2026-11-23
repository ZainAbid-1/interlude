import React, { useEffect } from 'react';
import { View, Text, Pressable, StyleSheet, AccessibilityInfo, Platform } from 'react-native';
import Animated, {
  FadeInUp,
  FadeOutUp,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BlurView } from 'expo-blur';
import { Ionicons } from '@expo/vector-icons';
import { haptic } from '../lib/haptics';
import { PlayerAvatar } from './PlayerAvatar';
import { Colors, Spacing, BorderRadius } from '../constants/theme';
import { useNoticeStore, type Notice } from '../store/noticeStore';
import { useInviteStore } from '../store/inviteStore';
import { useGameStore } from '../store/gameStore';

const KIND = {
  success: { icon: 'checkmark-circle', color: Colors.correct, bg: Colors.correctBg, label: 'Done' },
  info: { icon: 'notifications', color: '#ffffff', bg: 'rgba(255, 255, 255, 0.12)', label: 'Notice' },
  error: { icon: 'alert-circle', color: Colors.incorrect, bg: Colors.incorrectBg, label: 'Problem' },
} as const;

/**
 * Shows the first message in the queue at the top of the screen.
 * Waits while a round is being played or a challenge pop-up is open,
 * so it never covers the answer buttons or the Join button.
 */
export function NoticeToast() {
  const notice = useNoticeStore((s) => s.queue[0]);
  const inMatch = useGameStore((s) => s.currentRound !== null && !s.gameOver);
  const inviteShowing = useInviteStore((s) => s.incoming.length > 0);

  if (!notice || inMatch || inviteShowing) return null;
  return <ToastCard key={notice.id} notice={notice} />;
}

function ToastCard({ notice }: { notice: Notice }) {
  const insets = useSafeAreaInsets();
  const dismiss = useNoticeStore((s) => s.dismiss);
  const kind = KIND[notice.kind];
  const offset = useSharedValue(0);

  useEffect(() => {
    if (notice.kind === 'error') {
      haptic.error();
    } else if (notice.kind === 'success') {
      haptic.success();
    } else {
      haptic.tap();
    }
    AccessibilityInfo.announceForAccessibility(
      [notice.title, notice.message].filter(Boolean).join('. ')
    );
    if (!notice.duration) return;
    const t = setTimeout(() => dismiss(notice.id), notice.duration);
    return () => clearTimeout(t);
  }, [notice, dismiss]);

  const close = () => dismiss(notice.id);

  // Flick it up (or sideways) to put it away.
  const pan = Gesture.Pan()
    .onUpdate((e) => {
      offset.value = Math.min(0, e.translationY);
    })
    .onEnd((e) => {
      if (e.translationY < -24 || e.velocityY < -500) {
        offset.value = withTiming(-160, { duration: 160 }, () => runOnJS(close)());
      } else {
        offset.value = withTiming(0, { duration: 160 });
      }
    });

  const dragStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: offset.value }],
    opacity: 1 + offset.value / 200,
  }));

  const runAction = () => {
    close();
    notice.action?.onPress();
  };

  return (
    <Animated.View
      entering={FadeInUp.duration(260)}
      exiting={FadeOutUp.duration(180)}
      style={[styles.wrap, { top: insets.top + Spacing.sm }]}
      pointerEvents="box-none"
    >
      <GestureDetector gesture={pan}>
        <Animated.View
          style={[styles.card, dragStyle]}
          accessibilityRole="alert"
          accessibilityLiveRegion={notice.kind === 'error' ? 'assertive' : 'polite'}
        >
          <BlurView intensity={60} tint="dark" style={StyleSheet.absoluteFill} />
          <View style={styles.cardTint} />
          <View style={[styles.accent, { backgroundColor: kind.color }]} />

          <View style={styles.row}>
            {notice.avatar ? (
              <PlayerAvatar uri={notice.avatar.uri ?? null} name={notice.avatar.name} size={40} />
            ) : (
              <View style={[styles.iconWrap, { backgroundColor: kind.bg }]}>
                <Ionicons name={notice.icon ?? kind.icon} size={22} color={kind.color} />
              </View>
            )}

            <View style={styles.textCol}>
              <Text style={styles.title} maxFontSizeMultiplier={1.4}>
                {notice.title}
              </Text>
              {notice.message ? (
                <Text style={styles.message} maxFontSizeMultiplier={1.4}>
                  {notice.message}
                </Text>
              ) : null}
            </View>

            <Pressable
              onPress={close}
              hitSlop={10}
              accessibilityRole="button"
              accessibilityLabel="Close message"
            >
              <View style={styles.closeButton}>
                <Ionicons name="close" size={18} color={Colors.textSubtle} />
              </View>
            </Pressable>
          </View>

          {notice.action ? (
            <Pressable onPress={runAction} accessibilityRole="button">
              <View style={styles.actionButton}>
                <Text style={styles.actionText} maxFontSizeMultiplier={1.3}>
                  {notice.action.label}
                </Text>
              </View>
            </Pressable>
          ) : null}
        </Animated.View>
      </GestureDetector>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    left: Spacing.md,
    right: Spacing.md,
    zIndex: 999,
    elevation: 999,
  },
  card: {
    borderRadius: BorderRadius.xl,
    overflow: 'hidden',
    paddingVertical: 14,
    paddingLeft: 18,
    paddingRight: 10,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.18)',
    gap: 12,
    ...Platform.select({
      ios: { shadowColor: '#000', shadowOpacity: 0.4, shadowRadius: 16, shadowOffset: { width: 0, height: 8 } },
      default: {},
    }),
  },
  cardTint: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(15, 15, 15, 0.88)',
  },
  accent: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    width: 4,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  iconWrap: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  textCol: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  title: {
    fontFamily: 'Inter-Bold',
    fontSize: 15,
    lineHeight: 20,
    color: '#ffffff',
  },
  message: {
    fontFamily: 'Inter',
    fontSize: 13,
    lineHeight: 18,
    color: Colors.textSubtle,
  },
  closeButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionButton: {
    height: 44,
    marginRight: 8,
    borderRadius: 22,
    backgroundColor: '#ffffff',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
  },
  actionText: {
    fontFamily: 'Inter-Bold',
    fontSize: 15,
    color: '#000000',
  },
});
