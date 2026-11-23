import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ScrollView,
  ActivityIndicator,
  AppState,
  Linking,
} from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter } from 'expo-router';
import Constants from 'expo-constants';
import { Colors, Spacing, BorderRadius } from '../../constants/theme';
import { useAuthStore } from '../../store/authStore';
import { supabase } from '../../lib/supabase';
import { GlassCard } from '../../components/GlassCard';
import { ToggleSwitch } from '../../components/ToggleSwitch';
import { haptic } from '../../lib/haptics';
import { notify, confirm } from '../../store/noticeStore';
import { getPushPermission, requestPushPermission, registerPush, type PushPermission } from '../../services/push';
import { AlbumCollageBackground } from '../../components/AlbumCollageBackground';
import { PlayerAvatar } from '../../components/PlayerAvatar';
import { getLeaderboard, listLeaderboardArtists } from '../../services/leaderboard';

const DANGER = '#ff6b6b';
const APP_VERSION = Constants.expoConfig?.version ?? '1.0.0';

type IconName = keyof typeof Ionicons.glyphMap;

interface Stats {
  matches: number;
  wins: number;
  artists: number;
  bestArtist: string | null;
  /** Elo rating (the All artists board score); null before the first match. */
  rating: number | null;
}

export default function SettingsScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const session = useAuthStore((s) => s.session);
  const profile = useAuthStore((s) => s.profile);
  const signOut = useAuthStore((s) => s.signOut);
  const isLoggedIn = Boolean(session);

  const [stats, setStats] = useState<Stats | null>(null);
  const [discoverable, setDiscoverable] = useState<boolean | null>(null);
  const [savingVisibility, setSavingVisibility] = useState(false);
  const [showScoring, setShowScoring] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [prefs, setPrefs] = useState<NotifyPrefs | null>(null);
  const [push, setPush] = useState<{ status: PushPermission; canAsk: boolean } | null>(null);

  // Re-check the phone's permission on focus and when coming back from the
  // phone's settings, so the row is never out of date.
  const [pushError, setPushError] = useState<string | null>(null);
  const [checkingPush, setCheckingPush] = useState(false);
  const refreshPush = useCallback(async () => {
    const p = await getPushPermission();
    setPush(p);
    if (p.status !== 'granted') return;
    // "On" only counts once the server really has this phone's address.
    setCheckingPush(true);
    setPushError(await registerPush());
    setCheckingPush(false);
  }, []);
  useEffect(() => {
    const sub = AppState.addEventListener('change', (st) => {
      if (st === 'active') refreshPush();
    });
    return () => sub.remove();
  }, [refreshPush]);

  const load = useCallback(async () => {
    if (!isLoggedIn || !profile?.id) return;
    const [board, artists] = await Promise.all([
      getLeaderboard(null, 'friends', 'all'),
      listLeaderboardArtists('all'),
    ]);
    const me = board.data?.find((r) => r.is_me);
    const mine = (artists.data ?? []).filter((a) => a.my_matches > 0);
    const best = [...mine].sort((a, b) => (b.my_best ?? 0) - (a.my_best ?? 0))[0];
    setStats({
      matches: me?.matches ?? 0,
      wins: me?.wins ?? 0,
      artists: mine.length,
      bestArtist: best?.artist_name ?? null,
      rating: me ? me.score : null,
    });

    if (supabase) {
      const { data } = await supabase
        .from('profiles')
        .select('discoverable, notify_challenges, notify_friend_requests, notify_friend_accepts')
        .eq('id', profile.id)
        .maybeSingle();
      if (data && typeof data.discoverable === 'boolean') setDiscoverable(data.discoverable);
      setPrefs({
        notify_challenges: data?.notify_challenges ?? true,
        notify_friend_requests: data?.notify_friend_requests ?? true,
        notify_friend_accepts: data?.notify_friend_accepts ?? true,
      });
    }
  }, [isLoggedIn, profile?.id]);

  useFocusEffect(
    useCallback(() => {
      load();
      refreshPush();
    }, [load, refreshPush])
  );

  const toggleDiscoverable = async (next: boolean) => {
    if (!supabase || !profile?.id || savingVisibility) return;
    const prev = discoverable;
    setDiscoverable(next); // optimistic
    setSavingVisibility(true);
    const { error } = await supabase
      .from('profiles')
      .update({ discoverable: next })
      .eq('id', profile.id);
    setSavingVisibility(false);
    if (error) {
      setDiscoverable(prev);
      notify.error("Couldn't save that change", 'Check your connection and try again.', {
        action: { label: 'Try again', onPress: () => toggleDiscoverable(next) },
      });
    }
  };

  const savePref = async (key: keyof NotifyPrefs, next: boolean) => {
    if (!supabase || !profile?.id || !prefs) return;
    const before = prefs;
    setPrefs({ ...prefs, [key]: next }); // optimistic
    const { error } = await supabase.from('profiles').update({ [key]: next }).eq('id', profile.id);
    if (error) {
      setPrefs(before);
      notify.error("Couldn't save that change", 'Check your connection and try again.', {
        action: { label: 'Try again', onPress: () => savePref(key, next) },
      });
    }
  };

  const turnOnPush = async () => {
    if (push?.status === 'denied' || (push && !push.canAsk)) {
      // The phone won't ask again; only its own settings can switch it on.
      Linking.openSettings().catch(() => {});
      return;
    }
    const result = await requestPushPermission();
    refreshPush();
    if (result === 'granted') notify.success('Notifications are on');
  };

  const handleSignOut = async () => {
    const ok = await confirm({
      title: 'Log out of Interlude?',
      message: 'You can sign back in with Google anytime.',
      confirmLabel: 'Log out',
      destructive: true,
      icon: 'log-out-outline',
    });
    if (!ok) return;
    setSigningOut(true);
    await signOut();
    setSigningOut(false);
    router.replace('/login');
  };

  const name = profile?.display_name || (profile?.username ? `@${profile.username}` : 'Not signed in');

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      <AlbumCollageBackground />

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[styles.scrollContent, { paddingBottom: insets.bottom + 100 }]}
        showsVerticalScrollIndicator={false}
      >
        <Animated.View entering={FadeInDown.delay(100).duration(500)} style={styles.header}>
          <Text style={styles.headerTitle}>Settings</Text>
        </Animated.View>

        {/* Profile */}
        <Animated.View entering={FadeInDown.delay(150).duration(500)}>
          <GlassCard borderRadius={24} padding={20}>
            <View style={styles.profileRow}>
              <PlayerAvatar uri={profile?.avatar_url} name={profile?.display_name || profile?.username} size={64} />
              <View style={styles.flex}>
                <Text style={styles.displayName}>
                  {name}
                </Text>
                {profile?.username ? (
                  <Text style={styles.usernameText}>
                    @{profile.username}
                  </Text>
                ) : null}
                <View style={styles.badge}>
                  <Ionicons
                    name={isLoggedIn ? 'logo-google' : 'alert-circle-outline'}
                    size={12}
                    color={isLoggedIn ? '#ffffff' : Colors.textMuted}
                  />
                  <Text style={styles.badgeText}>{isLoggedIn ? 'Signed in with Google' : 'Signed out'}</Text>
                </View>
              </View>
            </View>

            {isLoggedIn ? (
              <Pressable
                onPress={() => router.push('/leaderboard')}
                accessibilityRole="button"
                accessibilityLabel="Open the leaderboard"
              >
                <View style={styles.stats}>
                  {stats ? (
                    <>
                      <Stat value={String(stats.matches)} label="Matches" />
                      <View style={styles.statDivider} />
                      <Stat value={String(stats.wins)} label="Wins" />
                      <View style={styles.statDivider} />
                      <Stat
                        value={stats.rating == null ? '1,000' : stats.rating.toLocaleString('en-US')}
                        label="Rating"
                      />
                      <View style={styles.statDivider} />
                      <Stat value={String(stats.artists)} label="Artists" />
                    </>
                  ) : (
                    <ActivityIndicator color="#ffffff" style={styles.statsLoading} />
                  )}
                </View>
                {stats ? (
                  <Text style={styles.statsHint}>
                    {stats.bestArtist
                      ? `You know ${stats.bestArtist} best. Tap to see the leaderboard.`
                      : 'Finish a match to start your stats. Tap to see the leaderboard.'}
                  </Text>
                ) : null}
              </Pressable>
            ) : null}
          </GlassCard>
        </Animated.View>

        {/* Account */}
        {isLoggedIn ? (
          <Animated.View entering={FadeInDown.delay(200).duration(500)}>
            <SectionLabel>Account</SectionLabel>
            <GlassCard borderRadius={20} padding={0}>
              {profile?.username !== undefined ? (
                <Row
                  icon="at"
                  title="Username"
                  hint={profile?.username ? `Friends find you by @${profile.username}` : 'Pick a username so friends can find you'}
                  value="Change"
                  onPress={() => router.push('/username?edit=1')}
                />
              ) : null}
              <ToggleRow
                divider={profile?.username !== undefined}
                icon="eye-outline"
                title="Show me in player search"
                hint={
                  discoverable === false
                    ? 'Off: only existing friends can find you, and you are hidden from the global leaderboard.'
                    : 'Anyone can find you by name or username and see you on the global leaderboard.'
                }
                value={discoverable}
                disabled={savingVisibility}
                onChange={toggleDiscoverable}
              />
            </GlassCard>
          </Animated.View>
        ) : null}

        {/* Notifications */}
        {isLoggedIn ? (
          <Animated.View entering={FadeInDown.delay(225).duration(500)}>
            <SectionLabel>Notifications</SectionLabel>
            <GlassCard borderRadius={20} padding={0}>
              <PushStatusCard
                push={push}
                error={pushError}
                checking={checkingPush}
                onTurnOn={turnOnPush}
                onRetry={refreshPush}
              />
              <Text style={styles.groupLabel}>Send me alerts for</Text>
              {(
                [
                  ['notify_challenges', 'flash-outline', 'Challenges', 'A friend challenges you to a match. You have 2 minutes to join.'],
                  ['notify_friend_requests', 'person-add-outline', 'Friend requests', 'Someone wants to add you as a friend.'],
                  ['notify_friend_accepts', 'people-outline', 'Accepted requests', 'Someone accepts your friend request.'],
                ] as const
              ).map(([key, icon, title, hint], i) => (
                <ToggleRow
                  key={key}
                  divider={i > 0}
                  icon={icon}
                  title={title}
                  hint={hint}
                  value={prefs ? prefs[key] : null}
                  onChange={(v) => savePref(key, v)}
                />
              ))}
            </GlassCard>
          </Animated.View>
        ) : null}

        {/* Help */}
        <Animated.View entering={FadeInDown.delay(250).duration(500)}>
          <SectionLabel>Help</SectionLabel>
          <GlassCard borderRadius={20} padding={0}>
            <Row
              icon="trophy-outline"
              title="How scoring works"
              hint="Points, speed bonus and rankings"
              chevron={showScoring ? 'chevron-up' : 'chevron-down'}
              onPress={() => setShowScoring((v) => !v)}
            />
            {showScoring ? (
              <View style={styles.helpBody}>
                <HelpLine icon="musical-notes-outline" text="Each round plays a short clip. Pick the song from 4 options within 8 seconds." />
                <HelpLine icon="checkmark-circle-outline" text="Right answer: 100 points, plus up to 100 more for speed. Answer instantly for the full bonus; it runs out at 8 seconds." />
                <HelpLine icon="close-circle-outline" text="Wrong answer or no answer: 0 points." />
                <HelpLine icon="podium-outline" text="Artist boards rank your best single match for that artist." />
                <HelpLine icon="trending-up-outline" text="All artists ranks by rating. Everyone starts at 1,000; beating a stronger player earns more, beating a weaker one less." />
                <HelpLine icon="exit-outline" text="Leaving a match that has started counts as a loss. If your opponent disappears for over a minute, you win." />
              </View>
            ) : null}
          </GlassCard>
        </Animated.View>

        {/* About */}
        <Animated.View entering={FadeInDown.delay(300).duration(500)}>
          <SectionLabel>About</SectionLabel>
          <GlassCard borderRadius={20} padding={0}>
            <Row icon="information-circle-outline" title="Version" value={APP_VERSION} />
          </GlassCard>
        </Animated.View>

        {/* Sign out / in */}
        <Animated.View entering={FadeInDown.delay(350).duration(500)}>
          {isLoggedIn ? (
            <Pressable
              onPress={handleSignOut}
              disabled={signingOut}
              accessibilityRole="button"
              accessibilityLabel="Log out"
            >
              <View style={[styles.bigButton, styles.logoutButton]}>
                {signingOut ? (
                  <ActivityIndicator color={DANGER} />
                ) : (
                  <>
                    <Ionicons name="log-out-outline" size={20} color={DANGER} />
                    <Text style={[styles.bigButtonText, { color: DANGER }]}>Log out</Text>
                  </>
                )}
              </View>
            </Pressable>
          ) : (
            <Pressable onPress={() => router.replace('/login')} accessibilityRole="button">
              <View style={[styles.bigButton, styles.loginButton]}>
                <Ionicons name="logo-google" size={20} color="#0a0a0a" />
                <Text style={[styles.bigButtonText, { color: '#0a0a0a' }]}>Sign in with Google</Text>
              </View>
            </Pressable>
          )}
        </Animated.View>

        <Text style={styles.footerText}>Interlude {APP_VERSION}</Text>
      </ScrollView>
    </View>
  );
}

interface NotifyPrefs {
  notify_challenges: boolean;
  notify_friend_requests: boolean;
  notify_friend_accepts: boolean;
}

type PushTone = 'good' | 'off' | 'bad' | 'info';
const TONE: Record<PushTone, { color: string; bg: string }> = {
  good: { color: Colors.correct, bg: Colors.correctBg },
  off: { color: '#ffffff', bg: 'rgba(255, 255, 255, 0.1)' },
  bad: { color: Colors.incorrect, bg: Colors.incorrectBg },
  info: { color: '#ffffff', bg: 'rgba(255, 255, 255, 0.1)' },
};

/**
 * Answers one question: will this phone tell me when a friend challenges me?
 * Each state comes with the one action that fixes it.
 */
function PushStatusCard({
  push,
  error,
  checking,
  onTurnOn,
  onRetry,
}: {
  push: { status: PushPermission; canAsk: boolean } | null;
  error: string | null;
  checking: boolean;
  onTurnOn: () => void;
  onRetry: () => void;
}) {
  if (!push) {
    return (
      <View style={[styles.statusCard, styles.statusLoading]}>
        <ActivityIndicator color="#ffffff" />
      </View>
    );
  }

  let tone: PushTone;
  let icon: IconName;
  let title: string;
  let text: string;
  let action: { label: string; onPress: () => void } | null = null;

  if (push.status === 'unsupported') {
    tone = 'info';
    icon = 'phone-portrait-outline';
    title = 'Alerts go to your phone';
    text =
      "The web version can't show notifications. Open Interlude on your Android phone or iPhone to get them. The choices below apply there.";
  } else if (push.status === 'granted' && error) {
    tone = 'bad';
    icon = 'warning-outline';
    title = 'Not working on this phone';
    text = `Notifications are allowed, but this phone couldn't be set up to receive them. ${error}`;
    action = { label: 'Try again', onPress: onRetry };
  } else if (push.status === 'granted') {
    tone = 'good';
    icon = 'notifications';
    title = 'On for this phone';
    text = "You'll be alerted even when Interlude is closed.";
  } else if (push.status === 'denied' || !push.canAsk) {
    tone = 'bad';
    icon = 'notifications-off-outline';
    title = "Blocked in your phone's settings";
    text = 'In the settings that open, tap Notifications and switch them on for Interlude.';
    action = { label: 'Open phone settings', onPress: onTurnOn };
  } else {
    tone = 'off';
    icon = 'notifications-off-outline';
    title = 'Off on this phone';
    text = "Turn on so you don't miss a friend's challenge. Challenges only last 2 minutes.";
    action = { label: 'Turn on notifications', onPress: onTurnOn };
  }

  const t = TONE[tone];
  return (
    <View style={styles.statusCard}>
      <View style={styles.statusTop} accessible accessibilityLabel={`${title}. ${text}`}>
        <View style={[styles.statusIcon, { backgroundColor: t.bg }]}>
          <Ionicons name={icon} size={22} color={t.color} />
        </View>
        <View style={styles.flex}>
          <Text style={[styles.statusTitle, tone === 'good' && { color: Colors.correct }]}>{title}</Text>
          <Text style={styles.statusText}>{text}</Text>
        </View>
      </View>
      {action ? (
        <Pressable onPress={action.onPress} disabled={checking} accessibilityRole="button">
          <View style={[styles.statusButton, tone === 'bad' && styles.statusButtonQuiet]}>
            {checking ? (
              <ActivityIndicator color={tone === 'bad' ? '#ffffff' : '#000000'} />
            ) : (
              <Text style={[styles.statusButtonText, tone === 'bad' && { color: '#ffffff' }]}>
                {action.label}
              </Text>
            )}
          </View>
        </Pressable>
      ) : null}
    </View>
  );
}

/** A setting you switch on or off. The whole row is the tap target. */
function ToggleRow({
  icon,
  title,
  hint,
  value,
  onChange,
  disabled,
  divider,
}: {
  icon: IconName;
  title: string;
  hint?: string;
  value: boolean | null;
  onChange: (next: boolean) => void;
  disabled?: boolean;
  divider?: boolean;
}) {
  const ready = value !== null;
  return (
    <Pressable
      onPress={() => {
        if (!ready || disabled) return;
        haptic.select();
        onChange(!value);
      }}
      disabled={!ready || disabled}
      accessibilityRole="switch"
      accessibilityLabel={title}
      accessibilityHint={hint}
      accessibilityState={{ checked: !!value, disabled: !ready || !!disabled }}
      android_ripple={{ color: 'rgba(255,255,255,0.08)' }}
    >
      <View style={[styles.row, divider && styles.rowDivider]}>
        <View style={styles.rowIcon}>
          <Ionicons name={icon} size={19} color="#ffffff" />
        </View>
        <View style={styles.flex}>
          <Text style={styles.rowTitle}>{title}</Text>
          {hint ? <Text style={styles.rowHint}>{hint}</Text> : null}
        </View>
        {ready ? (
          <ToggleSwitch value={!!value} disabled={disabled} decorative />
        ) : (
          <ActivityIndicator color="#ffffff" />
        )}
      </View>
    </Pressable>
  );
}

function SectionLabel({ children }: { children: string }) {
  return <Text style={styles.sectionLabel}>{children}</Text>;
}

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

function HelpLine({ icon, text }: { icon: IconName; text: string }) {
  return (
    <View style={styles.helpLine}>
      <View style={styles.helpIcon}>
        <Ionicons name={icon} size={16} color={Colors.textSubtle} />
      </View>
      <Text style={styles.helpText}>{text}</Text>
    </View>
  );
}

/**
 * One settings row: icon, title, optional hint, and on the right a value,
 * a control, or a chevron when it opens something. Whole row is the target.
 */
function Row({
  icon,
  title,
  hint,
  value,
  right,
  chevron,
  onPress,
  divider,
}: {
  icon: IconName;
  title: string;
  hint?: string;
  value?: string;
  right?: React.ReactNode;
  chevron?: IconName;
  onPress?: () => void;
  divider?: boolean;
}) {
  const body = (
    <View style={[styles.row, divider && styles.rowDivider]}>
      <View style={styles.rowIcon}>
        <Ionicons name={icon} size={19} color="#ffffff" />
      </View>
      <View style={styles.flex}>
        <Text style={styles.rowTitle}>{title}</Text>
        {hint ? <Text style={styles.rowHint}>{hint}</Text> : null}
      </View>
      {value ? <Text style={styles.rowValue}>{value}</Text> : null}
      {right}
      {onPress ? (
        <Ionicons name={chevron ?? 'chevron-forward'} size={18} color={Colors.textSubtle} />
      ) : null}
    </View>
  );
  if (!onPress) return body;
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={title} android_ripple={{ color: 'rgba(255,255,255,0.08)' }}>
      {body}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: Colors.background },
  scroll: { flex: 1 },
  statusCard: { padding: 16, gap: 14 },
  statusLoading: { alignItems: 'center', paddingVertical: 28 },
  statusTop: { flexDirection: 'row', alignItems: 'flex-start', gap: 14 },
  statusIcon: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  statusTitle: { fontFamily: 'Inter-Bold', fontSize: 16, lineHeight: 21, color: '#ffffff' },
  statusText: { fontFamily: 'Inter', fontSize: 13, lineHeight: 18, color: Colors.textSubtle, marginTop: 3 },
  statusButton: {
    height: 46,
    borderRadius: 23,
    backgroundColor: '#ffffff',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
  },
  statusButtonQuiet: {
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.18)',
  },
  statusButtonText: { fontFamily: 'Inter-Bold', fontSize: 15, color: '#000000' },
  groupLabel: {
    fontFamily: 'Inter-Bold',
    fontSize: 11,
    letterSpacing: 1.2,
    textTransform: 'uppercase',
    color: Colors.textMuted,
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 2,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(255, 255, 255, 0.1)',
  },
  onPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    height: 28,
    paddingHorizontal: 12,
    borderRadius: 14,
    backgroundColor: Colors.correctBg,
  },
  onDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: Colors.correct },
  onPillText: { fontFamily: 'Inter-Bold', fontSize: 13, color: Colors.correct },
  scrollContent: { padding: Spacing.containerPadding, gap: Spacing.md },
  flex: { flex: 1 },
  header: { marginTop: Spacing.md, marginBottom: Spacing.xs },
  headerTitle: {
    fontFamily: 'Antonio',
    fontSize: 40,
    lineHeight: 44,
    color: '#ffffff',
    letterSpacing: 3,
    textTransform: 'uppercase',
    textShadowColor: 'rgba(0, 0, 0, 0.95)',
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 8,
  },
  profileRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  displayName: { fontFamily: 'Inter-Bold', fontSize: 19, color: '#ffffff' },
  usernameText: { fontFamily: 'Inter', fontSize: 13, color: Colors.textSubtle, marginTop: 2 },
  badge: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 8,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: BorderRadius.full,
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.2)',
  },
  badgeText: { fontFamily: 'Inter', fontSize: 12, color: '#ffffff' },
  stats: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: Spacing.md,
    paddingVertical: 12,
    borderRadius: 16,
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
    minHeight: 64,
  },
  statsLoading: { flex: 1 },
  stat: { flex: 1, alignItems: 'center', gap: 2 },
  statValue: { fontFamily: 'Inter-Bold', fontSize: 18, color: '#ffffff' },
  statLabel: { fontFamily: 'Inter', fontSize: 11, color: Colors.textMuted },
  statDivider: { width: 1, height: 28, backgroundColor: 'rgba(255, 255, 255, 0.12)' },
  statsHint: { fontFamily: 'Inter', fontSize: 12, color: Colors.textMuted, marginTop: 8, textAlign: 'center' },
  sectionLabel: {
    fontFamily: 'Inter-Bold',
    fontSize: 12,
    color: Colors.textSubtle,
    letterSpacing: 1.2,
    textTransform: 'uppercase',
    marginLeft: 6,
    marginBottom: 8,
    marginTop: Spacing.xs,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    minHeight: 60,
    paddingVertical: 12,
    paddingHorizontal: 16,
  },
  rowDivider: { borderTopWidth: 1, borderTopColor: 'rgba(255, 255, 255, 0.07)' },
  rowIcon: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowTitle: { fontFamily: 'Inter-Bold', fontSize: 15, color: '#ffffff' },
  rowHint: { fontFamily: 'Inter', fontSize: 12, lineHeight: 17, color: Colors.textMuted, marginTop: 2 },
  rowValue: { fontFamily: 'Inter-Bold', fontSize: 13, color: Colors.textSubtle },
  // Same grid as Row: 16 padding, 36 icon column, 14 gap, so the text lines
  // up with the row title and the icons sit under the row icon.
  helpBody: { paddingHorizontal: 16, paddingBottom: 16, gap: 12 },
  helpLine: { flexDirection: 'row', gap: 14 },
  helpIcon: { width: 36, height: 19, alignItems: 'center', justifyContent: 'center' },
  helpText: { flex: 1, fontFamily: 'Inter', fontSize: 13, lineHeight: 19, color: Colors.textSubtle },
  bigButton: {
    height: 52,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderRadius: BorderRadius.full,
    marginTop: Spacing.sm,
  },
  logoutButton: {
    backgroundColor: 'rgba(255, 80, 80, 0.12)',
    borderWidth: 1,
    borderColor: 'rgba(255, 107, 107, 0.4)',
  },
  loginButton: { backgroundColor: '#ffffff' },
  bigButtonText: { fontFamily: 'Inter-Bold', fontSize: 15 },
  footerText: {
    fontFamily: 'Inter',
    fontSize: 12,
    color: Colors.textMuted,
    textAlign: 'center',
    marginTop: Spacing.sm,
  },
});
