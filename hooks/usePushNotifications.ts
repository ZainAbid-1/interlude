import { useEffect, useRef } from 'react';
import { AppState } from 'react-native';
import * as Notifications from 'expo-notifications';
import {
  pushSupported,
  configurePush,
  registerPush,
  showInApp,
  handleResponse,
  clearEndedChallenges,
} from '../services/push';

/**
 * App-wide notification wiring. `ready` means signed in and past the start
 * screen: a tap that opened the app is held until then, so it isn't lost
 * to the redirect that happens while the app starts.
 */
export function usePushNotifications(userId: string | undefined, ready: boolean) {
  const pending = useRef<Notifications.NotificationResponse | null>(null);
  const readyRef = useRef(ready);
  readyRef.current = ready;

  // Listeners for the whole time the app runs.
  useEffect(() => {
    if (!pushSupported) return;
    configurePush();
    const received = Notifications.addNotificationReceivedListener((n) => {
      if (readyRef.current) showInApp(n);
    });
    const tapped = Notifications.addNotificationResponseReceivedListener((r) => {
      if (readyRef.current) handleResponse(r);
      else pending.current = r;
    });
    return () => {
      received.remove();
      tapped.remove();
    };
  }, []);

  // Once signed in and on a real screen: register this phone, and act on a
  // tap that launched the app.
  useEffect(() => {
    if (!pushSupported || !ready || !userId) return;
    registerPush();
    clearEndedChallenges();

    const t = setTimeout(async () => {
      const r = pending.current ?? (await Notifications.getLastNotificationResponseAsync().catch(() => null));
      pending.current = null;
      if (r) handleResponse(r);
    }, 300);

    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') clearEndedChallenges();
    });
    return () => {
      clearTimeout(t);
      sub.remove();
    };
  }, [ready, userId]);
}
