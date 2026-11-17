import React, { useCallback, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  Alert,
  ScrollView,
  Switch,
  ActivityIndicator,
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
        .select('discoverable')
        .eq('id', profile.id)
        .maybeSingle();
      if (data && typeof data.discoverable === 'boolean') setDiscoverable(data.discoverable);
    }
  }, [isLoggedIn, profile?.id]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
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
      Alert.alert('Could not save', 'Check your connection and try again.');
    }
  };

  const handleSignOut = () => {
    Alert.alert('Log out of Interlude?', 'You can sign back in with Google anytime.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Log out',
        style: 'destructive',
        onPress: async () => {
          setSigningOut(true);
          await signOut();
          setSigningOut(false);
          router.replace('/login');
        },
      },
    ]);
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
                <Text style={styles.displayName} numberOfLines={2}>
                  {name}
                </Text>
                {profile?.username ? (
                  <Text style={styles.usernameText} numberOfLines={1}>
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
                  <Text style={styles.statsHint} numberOfLines={2}>
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
              <Row
                divider={profile?.username !== undefined}
                icon="eye-outline"
                title="Show me in player search"
                hint={
                  discoverable === false
                    ? 'Off: only existing friends can find you, and you are hidden from the global leaderboard.'
                    : 'Anyone can find you by name or username and see you on the global leaderboard.'
                }
                right={
                  discoverable === null ? (
                    <ActivityIndicator color="#ffffff" />
                  ) : (
                    <Switch
                      value={discoverable}
                      onValueChange={toggleDiscoverable}
                      disabled={savingVisibility}
                      trackColor={{ false: 'rgba(255,255,255,0.18)', true: Colors.correct }}
                      thumbColor="#ffffff"
                      accessibilityLabel="Show me in player search"
                    />
                  )
                }
              />
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
