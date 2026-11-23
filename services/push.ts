import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import Constants from 'expo-constants';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { router } from 'expo-router';
import { rpc } from './friends';
import { setPushToken } from './pushToken';
import { notify, confirm } from '../store/noticeStore';
import { useInviteStore } from '../store/inviteStore';
import { joinChallenge, declineChallenge } from './challenge';
import { useGameStore, forfeitMatch } from '../store/gameStore';

/**
 * Phone notifications (the ones that arrive while the app is closed).
 * The database sends them (supabase/notifications.sql); this file asks for
 * permission, registers the phone, and routes taps to the right screen.
 */

export type PushPermission = 'granted' | 'denied' | 'undetermined' | 'unsupported';

type PushData =
  | { type: 'challenge'; inviteId: string; roomId: string; fromId: string; fromName?: string; expiresAt?: string }
  | { type: 'friend_request'; userId: string; name?: string }
  | { type: 'friend_accepted'; userId: string; name?: string };

export const pushSupported = Platform.OS === 'android' || Platform.OS === 'ios';

const OFFER_KEY = 'interlude.pushOffer.v1';
const OFFER_AGAIN_AFTER_MS = 7 * 24 * 60 * 60 * 1000;
let configured = false;

// ── Setup (once per launch) ────────────────────────────────────────────

export async function configurePush() {
  if (!pushSupported || configured) return;
  configured = true;

  // While the app is open, our own pop-ups show instead of a phone banner,
  // so nothing is announced twice.
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: false,
      shouldShowList: false,
      shouldPlaySound: false,
      shouldSetBadge: false,
    }),
  });

  try {
    if (Platform.OS === 'android') {
      // Separate channels so people can mute friend news but keep challenges.
      await Notifications.setNotificationChannelAsync('challenges', {
        name: 'Challenges',
        description: 'When a friend challenges you to a match',
        importance: Notifications.AndroidImportance.HIGH,
        vibrationPattern: [0, 200, 120, 200],
        lightColor: '#FFFFFF',
      });
      await Notifications.setNotificationChannelAsync('friends', {
        name: 'Friends',
        description: 'Friend requests and accepted requests',
        importance: Notifications.AndroidImportance.DEFAULT,
      });
    }
    await Notifications.setNotificationCategoryAsync('challenge', [
      { identifier: 'join', buttonTitle: 'Join', options: { opensAppToForeground: true } },
      {
        identifier: 'decline',
        buttonTitle: 'Decline',
        options: { opensAppToForeground: true, isDestructive: true },
      },
    ]);
  } catch {
    // A missing channel only changes how the alert looks; carry on.
  }
}

// ── Permission ─────────────────────────────────────────────────────────

export async function getPushPermission(): Promise<{ status: PushPermission; canAsk: boolean }> {
  if (!pushSupported) return { status: 'unsupported', canAsk: false };
  try {
    const p = await Notifications.getPermissionsAsync();
    // Android 13+ reports "never asked" as denied; only a refusal the phone
    // won't ask about again is a real no.
    const status: PushPermission = p.granted
      ? 'granted'
      : p.status === 'undetermined' || p.canAskAgain
        ? 'undetermined'
        : 'denied';
    return { status, canAsk: p.canAskAgain };
  } catch {
    return { status: 'unsupported', canAsk: false };
  }
}

/** Shows the phone's own permission prompt. Registers the phone on yes. */
export async function requestPushPermission(): Promise<PushPermission> {
  if (!pushSupported) return 'unsupported';
  await configurePush(); // Android needs a channel before it will prompt
  try {
    const p = await Notifications.requestPermissionsAsync();
    if (p.granted) {
      await registerPush();
      return 'granted';
    }
    return p.status === 'undetermined' ? 'undetermined' : 'denied';
  } catch {
    return 'denied';
  }
}

/**
 * Explains notifications in our own words before the phone's prompt, at a
 * moment when they obviously help (just added a friend / sent a challenge).
 * Asks at most once a week, and never once the player has answered the
 * phone's prompt.
 */
export async function offerPushNotifications(reason: 'friend' | 'challenge') {
  const { status, canAsk } = await getPushPermission();
  if (status !== 'undetermined' || !canAsk) return;

  try {
    const last = Number(await AsyncStorage.getItem(OFFER_KEY));
    if (last && Date.now() - last < OFFER_AGAIN_AFTER_MS) return;
    await AsyncStorage.setItem(OFFER_KEY, String(Date.now()));
  } catch {
    // Storage unavailable: still offer.
  }

  // Let the screen settle (e.g. the lobby opening) before asking.
  await new Promise((r) => setTimeout(r, 700));
  const yes = await confirm({
    title: reason === 'challenge' ? 'Know when they challenge you back' : 'Know when friends challenge you',
    message:
      "We'll tell you about challenges and friend requests, even when Interlude is closed. Nothing else. You can change this in Settings.",
    confirmLabel: 'Turn on notifications',
    cancelLabel: 'Not now',
    icon: 'notifications-outline',
  });
  if (!yes) return;

  const result = await requestPushPermission();
  if (result === 'granted') {
    notify.success('Notifications are on', "You'll hear about challenges even when the app is closed.");
  } else {
    notify.info('Notifications are off', 'You can turn them on anytime in Settings.');
  }
}

// ── Registering this phone ─────────────────────────────────────────────

/** Why this phone couldn't be registered last time (null = it worked). */
let lastRegisterError: string | null = null;
export function getPushRegisterError() {
  return lastRegisterError;
}

/**
 * Gives this phone's address to the server, if notifications are allowed.
 * Returns null on success, or a reason Settings can show.
 */
export async function registerPush(): Promise<string | null> {
  if (!pushSupported) return null;
  const { status } = await getPushPermission();
  if (status !== 'granted') return null;
  await configurePush();
  let step = 'Getting this phone’s notification address';
  try {
    const projectId =
      Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId;
    const token = (await Notifications.getExpoPushTokenAsync({ projectId })).data;
    setPushToken(token);
    step = 'Saving it to the server';
    const res = await rpc('register_push_token', { p_token: token, p_platform: Platform.OS });
    if (res.error) throw new Error(res.error);
    lastRegisterError = null;
  } catch (e) {
    // Offline, no Firebase in this build, or notifications.sql not run.
    lastRegisterError = `${step} failed: ${(e as Error)?.message ?? 'unknown error'}`;
    console.warn('[push]', lastRegisterError);
  }
  return lastRegisterError;
}

// ── What a notification does ───────────────────────────────────────────

function readData(n: Notifications.Notification): PushData | null {
  const d = n.request.content.data as Partial<PushData> | undefined;
  return d && typeof d.type === 'string' ? (d as PushData) : null;
}

function challengeBack(id: string, name: string) {
  router.navigate({ pathname: '/(tabs)', params: { challenge: id, challengeName: name } });
}

/** A notification arrived while the app is open: show it our way. */
export function showInApp(n: Notifications.Notification) {
  const data = readData(n);
  if (!data) return;
  const title = n.request.content.title ?? '';
  const body = n.request.content.body ?? undefined;

  if (data.type === 'challenge') {
    // The challenge pop-up handles it; make sure it's up to date.
    useInviteStore.getState().refreshIncoming();
  } else if (data.type === 'friend_request') {
    notify.info(title, body, {
      icon: 'person-add',
      action: { label: 'See request', onPress: () => router.navigate('/(tabs)/friends') },
    });
  } else if (data.type === 'friend_accepted') {
    notify.success(title, body, {
      icon: 'people',
      action: { label: 'Challenge them', onPress: () => challengeBack(data.userId, data.name ?? 'your friend') },
    });
  }
}

const handled = new Set<string>();

/** The player tapped a notification (or one of its buttons). */
export async function handleResponse(response: Notifications.NotificationResponse) {
  const n = response.notification;
  const key = `${n.request.identifier}:${response.actionIdentifier}`;
  if (handled.has(key)) return;
  handled.add(key);
  Notifications.dismissNotificationAsync(n.request.identifier).catch(() => {});
  Notifications.clearLastNotificationResponseAsync().catch(() => {});

  const data = readData(n);
  if (!data) return;

  if (data.type === 'friend_request') {
    router.navigate('/(tabs)/friends');
    return;
  }
  if (data.type === 'friend_accepted') {
    router.push({ pathname: '/friend/[id]', params: { id: data.userId } });
    return;
  }

  // Challenge: is it still open?
  const name = data.fromName ?? 'your friend';
  await useInviteStore.getState().refreshIncoming();
  const invite = useInviteStore.getState().incoming.find((i) => i.id === data.inviteId);
  if (!invite) {
    notify.info('This challenge has ended', `${name}'s room isn't open anymore.`, {
      icon: 'time-outline',
      action: { label: `Challenge ${name.replace(/^@/, '')} back`, onPress: () => challengeBack(data.fromId, name) },
    });
    return;
  }
  if (response.actionIdentifier === 'decline') {
    await declineChallenge(invite);
    notify.info('Challenge declined', `We let ${name} know.`, { icon: 'close-circle-outline' });
    return;
  }
  if (response.actionIdentifier === 'join') {
    // Joining means leaving the match in progress, which is a forfeit.
    const g = useGameStore.getState();
    if (g.roomId && g.currentRound && !g.gameOver) {
      const leave = await confirm({
        title: `Leave your match to join ${name.replace(/^@/, '')}?`,
        message: 'Your current match will count as a loss.',
        confirmLabel: 'Leave and join',
        cancelLabel: 'Keep playing',
        destructive: true,
        icon: 'swap-horizontal',
      });
      if (!leave) return; // the challenge waits until this match ends
      await forfeitMatch();
    }
    await joinChallenge(invite);
    return;
  }
  // Tapped the notification itself: the challenge pop-up is showing with
  // Join and Decline, so the player decides there.
}

/** Removes challenge alerts from the phone's list once they've run out. */
export async function clearEndedChallenges() {
  if (!pushSupported) return;
  try {
    await useInviteStore.getState().refreshIncoming();
    const shown = await Notifications.getPresentedNotificationsAsync();
    const open = new Set(useInviteStore.getState().incoming.map((i) => i.id));
    for (const n of shown) {
      const data = readData(n);
      if (data?.type !== 'challenge') continue;
      if (!open.has(data.inviteId)) {
        await Notifications.dismissNotificationAsync(n.request.identifier);
      }
    }
  } catch {
    // Not supported on this phone; harmless.
  }
}
