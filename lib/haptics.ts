import { Platform } from 'react-native';
import * as Haptics from 'expo-haptics';

/**
 * Short vibrations that can never break the action they belong to. On the web
 * (and devices without a vibration motor) expo-haptics throws straight away
 * instead of returning a failed promise, so every call is guarded here.
 */
function run(fn: () => Promise<void>) {
  if (Platform.OS === 'web') return;
  try {
    fn().catch(() => {});
  } catch {
    // No vibration on this device: carry on silently.
  }
}

export const haptic = {
  /** A switch or picker changed. */
  select: () => run(() => Haptics.selectionAsync()),
  tap: () => run(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)),
  success: () => run(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)),
  warning: () => run(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning)),
  error: () => run(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error)),
};
