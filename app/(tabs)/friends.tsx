import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  Pressable,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  RefreshControl,
  Alert,
  KeyboardAvoidingView,
  Platform,
  useWindowDimensions,
} from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { GlassCard } from '../../components/GlassCard';
import { AlbumCollageBackground } from '../../components/AlbumCollageBackground';
import { PlayerAvatar } from '../../components/PlayerAvatar';
import { Colors, Spacing, BorderRadius } from '../../constants/theme';
import { supabase } from '../../lib/supabase';
import { useAuthStore } from '../../store/authStore';
import {
  Friend,
  Player,
  Relation,
  listFriends,
  removeFriend,
  respondFriendRequest,
  searchPlayers,
  sendFriendRequest,
} from '../../services/friends';

// Measured in Inter-Bold 14: "Head to head" + icon + padding needs ~136px at
// normal text size; Play fills the rest but should stay at least 96px wide.
// Both must fit inside screen padding (24 x 2) and card padding (24 x 2).
const ACTION_BUTTON_MIN = 136;
const PLAY_MIN = 96;
const ACTION_GAP = 8;

export default function FriendsScreen() {
  const insets = useSafeAreaInsets();
  const { width: windowWidth, fontScale } = useWindowDimensions();
  const actionRowWidth = windowWidth - Spacing.containerPadding * 2 - 24 * 2;
  const stackActions =
    actionRowWidth < ACTION_BUTTON_MIN * Math.min(Math.max(fontScale, 1), 1.3) + ACTION_GAP + PLAY_MIN;
  const profile = useAuthStore((s) => s.profile);
  const me = profile?.id;

  const [friends, setFriends] = useState<Friend[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [listError, setListError] = useState<string | null>(null);

  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Player[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);

  /** Player ids with an action in flight (disables their buttons). */
  const [busy, setBusy] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    const res = await listFriends();
    if (res.error) setListError(res.error);
    else {
      setListError(null);
      setFriends(res.data ?? []);
    }
    setLoading(false);
  }, []);

  // Fresh list whenever the tab is opened.
  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  // Live: requests sent to me, and my requests being accepted.
  const loadRef = useRef(load);
  loadRef.current = load;
  useEffect(() => {
    if (!supabase || !me) return;
    const ch = supabase
      .channel(`friends:${me}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'friendships', filter: `addressee_id=eq.${me}` },
        () => loadRef.current()
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'friendships', filter: `requester_id=eq.${me}` },
        () => loadRef.current()
      )
      .subscribe();
    return () => {
      supabase?.removeChannel(ch);
    };
  }, [me]);

  // Debounced player search.
  useEffect(() => {
    const q = query.trim().replace(/^@+/, '');
    if (q.length < 2) {
      setResults([]);
      setSearching(false);
      setSearchError(null);
      return;
    }
    setSearching(true);
    let cancelled = false;
    const timer = setTimeout(async () => {
      const res = await searchPlayers(q);
      if (cancelled) return;
      setSearching(false);
      if (res.error) {
        setSearchError(res.error);
        setResults([]);
      } else {
        setSearchError(null);
        setResults(res.data ?? []);
      }
    }, 350);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query]);

  const onRefresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  /** Runs an action for a player, updating rows optimistically. */
  const act = async (
    player: Player,
    action: () => Promise<{ data?: Relation | null; error?: string }>,
    optimistic: Relation
  ) => {
    setBusy((b) => new Set(b).add(player.id));
    const setRelation = (relation: Relation) => {
      setResults((rs) => rs.map((r) => (r.id === player.id ? { ...r, relation } : r)));
    };
    const before = player.relation;
    setRelation(optimistic);
    const res = await action();
    if (res.error) {
      setRelation(before);
      Alert.alert('Something went wrong', res.error);
    } else if (res.data) {
      setRelation(res.data);
    }
    await load();
    setBusy((b) => {
      const next = new Set(b);
      next.delete(player.id);
      return next;
    });
  };

  const add = (p: Player) => act(p, () => sendFriendRequest(p.id), 'outgoing');
  const accept = (p: Player) => act(p, () => respondFriendRequest(p.id, true), 'friend');
  const decline = (p: Player) => act(p, () => respondFriendRequest(p.id, false), 'none');
  const cancel = (p: Player) => act(p, () => removeFriend(p.id), 'none');
  const confirmRemove = (p: Player) =>
    Alert.alert('Remove friend', `Remove ${nameOf(p)} from your friends?`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: () => act(p, () => removeFriend(p.id), 'none') },
    ]);

  const incoming = useMemo(() => friends.filter((f) => f.relation === 'incoming'), [friends]);
  const accepted = useMemo(() => friends.filter((f) => f.relation === 'friend'), [friends]);
  const outgoing = useMemo(() => friends.filter((f) => f.relation === 'outgoing'), [friends]);

  const searchActive = query.trim().replace(/^@+/, '').length >= 2;

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      <AlbumCollageBackground />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={[styles.scrollContent, { paddingBottom: insets.bottom + 100 }]}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#ffffff" />
          }
        >
          {/* Header */}
          <Animated.View entering={FadeInDown.delay(100).duration(500)} style={styles.header}>
            <Text style={styles.headerTitle}>Friends</Text>
            {profile?.username ? (
              <Pressable onPress={() => router.push('/username?edit=1')} style={styles.meChip} hitSlop={6}>
                <Ionicons name="at" size={13} color="#ffffff" />
                <Text style={styles.meChipText}>{profile.username}</Text>
              </Pressable>
            ) : null}
          </Animated.View>

          {/* Search */}
          <Animated.View entering={FadeInDown.delay(200).duration(500)}>
            <GlassCard borderRadius={24}>
              <Text style={styles.cardTitle}>Find players</Text>
              <Text style={styles.cardHint}>Search by username or name</Text>
              <View style={styles.searchRow}>
                <Ionicons name="search" size={18} color={Colors.textSubtle} />
                <TextInput
                  style={styles.searchInput}
                  value={query}
                  onChangeText={setQuery}
                  placeholder="@username or name"
                  placeholderTextColor={Colors.textSubtle}
                  autoCapitalize="none"
                  autoCorrect={false}
                  returnKeyType="search"
                />
                {query ? (
                  <Pressable onPress={() => setQuery('')} hitSlop={8}>
                    <Ionicons name="close-circle" size={18} color={Colors.textSubtle} />
                  </Pressable>
                ) : null}
              </View>

              {searchActive ? (
                <View style={styles.resultsBlock}>
                {searching && results.length === 0 ? (
                  <ActivityIndicator color="#ffffff" />
                ) : searchError ? (
                  <Text style={[styles.errorText, styles.noTopMargin]}>{searchError}</Text>
                ) : results.length === 0 ? (
                  <Text style={[styles.emptyText, styles.noTopMargin]}>No players found</Text>
                ) : (
                  <View style={styles.list}>
                    {results.map((p) => (
                      <PlayerRow key={p.id} player={p}>
                        <RelationButton
                          relation={p.relation}
                          busy={busy.has(p.id)}
                          onAdd={() => add(p)}
                          onAccept={() => accept(p)}
                          onCancel={() => cancel(p)}
                        />
                      </PlayerRow>
                    ))}
                  </View>
                )}
                </View>
              ) : null}
            </GlassCard>
          </Animated.View>

          {listError ? (
            <GlassCard borderRadius={24}>
              <View style={styles.noticeRow}>
                <Ionicons name="alert-circle-outline" size={20} color={Colors.incorrect} />
                <Text style={styles.noticeText}>{listError}</Text>
              </View>
            </GlassCard>
          ) : null}

          {/* Incoming requests */}
          {incoming.length > 0 ? (
            <Animated.View entering={FadeInDown.duration(400)}>
              <GlassCard borderRadius={24}>
                <View style={styles.sectionHeader}>
                  <Text style={styles.cardTitle}>Requests</Text>
                  <View style={styles.countBadge}>
                    <Text style={styles.countBadgeText}>{incoming.length}</Text>
                  </View>
                </View>
                <View style={styles.list}>
                  {incoming.map((f) => (
                    <PlayerRow key={f.id} player={f}>
                      <View style={styles.rowActions}>
                        <Pressable
                          onPress={() => decline(f)}
                          disabled={busy.has(f.id)}
                          style={styles.iconButton}
                          hitSlop={6}
                        >
                          <Ionicons name="close" size={18} color={Colors.primary} />
                        </Pressable>
                        <PillButton label="Accept" onPress={() => accept(f)} busy={busy.has(f.id)} />
                      </View>
                    </PlayerRow>
                  ))}
                </View>
              </GlassCard>
            </Animated.View>
          ) : null}

          {/* Friends */}
          <Animated.View entering={FadeInDown.delay(300).duration(500)}>
            <GlassCard borderRadius={24}>
              <View style={styles.sectionHeader}>
                <Text style={styles.cardTitle}>Your friends</Text>
                {accepted.length > 0 ? <Text style={styles.sectionCount}>{accepted.length}</Text> : null}
              </View>
              {loading ? (
                <ActivityIndicator color="#ffffff" style={styles.inlineSpinner} />
              ) : accepted.length === 0 ? (
                <View style={styles.emptyBlock}>
                  <Ionicons name="people-outline" size={32} color={Colors.textMuted} />
                  <Text style={styles.emptyText}>
                    No friends yet. Search above to add someone you play with.
                  </Text>
                </View>
              ) : (
                <View style={styles.friendList}>
                  {accepted.map((f, i) => (
                    <View key={f.id} style={[styles.friendCard, i > 0 && styles.friendCardDivider]}>
                      {/* Name gets the full width; tapping it also opens head-to-head. */}
                      {/* Name row: tapping it opens head-to-head; "..." sits here so
                          the action row below has its full width for labels. */}
                      <View style={styles.friendTop}>
                        <Pressable
                          onPress={() => router.push(`/friend/${f.id}`)}
                          style={styles.flex1}
                          accessibilityRole="button"
                          accessibilityLabel={`Head to head with ${nameOf(f)}`}
                        >
                          <View style={styles.friendTopInner}>
                            <PlayerAvatar
                              uri={f.avatar_url}
                              name={f.display_name || f.username}
                              size={48}
                            />
                            <View style={styles.rowText}>
                              <Text style={styles.friendName} numberOfLines={2}>
                                {nameOf(f)}
                              </Text>
                              <Text style={styles.rowSub} numberOfLines={1}>
                                @{f.username}
                              </Text>
                              <Text style={styles.friendRecord} numberOfLines={1}>
                                {recordText(f)}
                              </Text>
                            </View>
                          </View>
                        </Pressable>
                        <Pressable
                          onPress={() => confirmRemove(f)}
                          disabled={busy.has(f.id)}
                          hitSlop={8}
                          accessibilityLabel={`More options for ${nameOf(f)}`}
                        >
                          <View style={styles.moreButton}>
                            <Ionicons name="ellipsis-horizontal" size={18} color={Colors.textSubtle} />
                          </View>
                        </Pressable>
                      </View>

                      {/* Every action is a labelled button, nothing hidden. On
                          narrow screens / large text they stack instead of cutting
                          "Head to head" short. */}
                      <View style={[styles.friendActions, stackActions && styles.friendActionsStacked]}>
                        <View style={stackActions ? undefined : styles.flex1}>
                          <WideButton
                            label="Play"
                            icon="play"
                            primary
                            onPress={() =>
                              router.navigate({
                                pathname: '/(tabs)',
                                params: { challenge: f.id, challengeName: nameOf(f) },
                              })
                            }
                          />
                        </View>
                        <View style={stackActions ? undefined : styles.noShrink}>
                          <WideButton
                            label="Head to head"
                            icon="stats-chart"
                            onPress={() => router.push(`/friend/${f.id}`)}
                          />
                        </View>
                      </View>
                    </View>
                  ))}
                </View>
              )}
            </GlassCard>
          </Animated.View>

          {/* Sent requests */}
          {outgoing.length > 0 ? (
            <Animated.View entering={FadeInDown.duration(400)}>
              <GlassCard borderRadius={24}>
                <Text style={[styles.cardTitle, styles.sentTitle]}>Sent</Text>
                <View style={styles.list}>
                  {outgoing.map((f) => (
                    <PlayerRow key={f.id} player={f} detail="Waiting for them to accept">
                      <PillButton label="Cancel" variant="muted" onPress={() => cancel(f)} busy={busy.has(f.id)} />
                    </PlayerRow>
                  ))}
                </View>
              </GlassCard>
            </Animated.View>
          ) : null}
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

// ─── Pieces ─────────────────────────────────────────────────────────────

function nameOf(p: Player): string {
  return p.display_name || `@${p.username}`;
}

function recordText(f: Friend): string {
  const played = f.wins + f.losses + f.draws;
  if (played === 0) return 'No matches yet';
  const parts = [`${f.wins}W`, `${f.losses}L`];
  if (f.draws) parts.push(`${f.draws}D`);
  return `${parts.join(' · ')} vs them`;
}

function PlayerRow({
  player,
  detail,
  onPress,
  children,
}: {
  player: Player;
  detail?: string;
  /** Tapping the photo/name (e.g. open the head-to-head page). */
  onPress?: () => void;
  children?: React.ReactNode;
}) {
  const info = (
    <View style={styles.rowInfo}>
      <PlayerAvatar uri={player.avatar_url} name={player.display_name || player.username} size={44} />
      <View style={styles.rowText}>
        <Text style={styles.rowName} numberOfLines={1}>
          {nameOf(player)}
        </Text>
        <Text style={styles.rowSub} numberOfLines={1}>
          @{player.username}
          {detail ? `  ·  ${detail}` : ''}
        </Text>
      </View>
      {onPress ? <Ionicons name="chevron-forward" size={14} color={Colors.textMuted} /> : null}
    </View>
  );
  return (
    <View style={styles.row}>
      {onPress ? (
        <Pressable onPress={onPress} style={styles.rowInfoPress}>
          {info}
        </Pressable>
      ) : (
        info
      )}
      {children}
    </View>
  );
}

function PillButton({
  label,
  onPress,
  busy,
  variant = 'primary',
  icon,
}: {
  label: string;
  onPress?: () => void;
  busy?: boolean;
  variant?: 'primary' | 'muted';
  icon?: React.ComponentProps<typeof Ionicons>['name'];
}) {
  const primary = variant === 'primary';
  const [pressed, setPressed] = useState(false);
  // NativeWind's JSX interop drops function-style Pressable styles, so the
  // visuals live on an inner View (same pattern as Login/Settings).
  return (
    <Pressable
      onPress={onPress}
      onPressIn={() => setPressed(true)}
      onPressOut={() => setPressed(false)}
      disabled={busy || !onPress}
      hitSlop={6}
    >
      <View
        style={[
          styles.pill,
          primary ? styles.pillPrimary : styles.pillMuted,
          pressed && styles.pressed,
        ]}
      >
        {busy ? (
          <ActivityIndicator size="small" color={primary ? '#000000' : '#ffffff'} />
        ) : (
          <>
            {icon ? <Ionicons name={icon} size={14} color={primary ? '#000000' : '#ffffff'} /> : null}
            <Text style={[styles.pillText, primary ? styles.pillTextPrimary : styles.pillTextMuted]}>
              {label}
            </Text>
          </>
        )}
      </View>
    </Pressable>
  );
}

/** Full-width labelled button for the friend card's action bar. */
function WideButton({
  label,
  icon,
  onPress,
  primary,
}: {
  label: string;
  icon: React.ComponentProps<typeof Ionicons>['name'];
  onPress: () => void;
  primary?: boolean;
}) {
  const [pressed, setPressed] = useState(false);
  const color = primary ? '#000000' : '#ffffff';
  return (
    <Pressable
      onPress={onPress}
      onPressIn={() => setPressed(true)}
      onPressOut={() => setPressed(false)}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      <View
        style={[
          styles.wideButton,
          primary ? styles.pillPrimary : styles.pillMuted,
          pressed && styles.pressed,
        ]}
      >
        <Ionicons name={icon} size={15} color={color} />
        <Text
          style={[styles.wideButtonText, { color }]}
          numberOfLines={1}
          adjustsFontSizeToFit
          minimumFontScale={0.8}
          maxFontSizeMultiplier={1.3}
        >
          {label}
        </Text>
      </View>
    </Pressable>
  );
}

function RelationButton({
  relation,
  busy,
  onAdd,
  onAccept,
  onCancel,
}: {
  relation: Relation;
  busy: boolean;
  onAdd: () => void;
  onAccept: () => void;
  onCancel: () => void;
}) {
  switch (relation) {
    case 'friend':
      return <PillButton label="Friends" variant="muted" icon="checkmark" busy={busy} />;
    case 'outgoing':
      return <PillButton label="Requested" variant="muted" onPress={onCancel} busy={busy} />;
    case 'incoming':
      return <PillButton label="Accept" onPress={onAccept} busy={busy} />;
    default:
      return <PillButton label="Add" icon="person-add" onPress={onAdd} busy={busy} />;
  }
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  scrollContent: {
    padding: Spacing.containerPadding,
    gap: Spacing.md,
  },
  header: {
    marginTop: Spacing.md,
    marginBottom: Spacing.xs,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
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
  meChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: BorderRadius.full,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.2)',
    maxWidth: '55%',
  },
  meChipText: {
    fontFamily: 'Inter-Bold',
    fontSize: 13,
    color: '#ffffff',
  },
  cardTitle: {
    fontFamily: 'Inter-Bold',
    fontSize: 15,
    color: Colors.primary,
  },
  cardHint: {
    fontFamily: 'Inter',
    fontSize: 13,
    color: Colors.textMuted,
    marginTop: 2,
    marginBottom: Spacing.md,
  },
  sentTitle: {
    marginBottom: Spacing.md,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    marginBottom: Spacing.md,
  },
  sectionCount: {
    fontFamily: 'Inter-Bold',
    fontSize: 13,
    color: Colors.textSubtle,
  },
  countBadge: {
    minWidth: 20,
    height: 20,
    paddingHorizontal: 6,
    borderRadius: 10,
    backgroundColor: '#ffffff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  countBadgeText: {
    fontFamily: 'Inter-Bold',
    fontSize: 11,
    color: '#000000',
  },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
    borderRadius: BorderRadius.md,
    borderWidth: 1,
    borderColor: Colors.glassBorder,
    paddingHorizontal: Spacing.md,
    paddingVertical: 10,
  },
  searchInput: {
    flex: 1,
    fontFamily: 'Inter',
    fontSize: 15,
    color: Colors.primary,
    padding: 0,
  },
  resultsBlock: {
    marginTop: Spacing.md,
  },
  noTopMargin: {
    marginTop: 0,
  },
  list: {
    gap: Spacing.md,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    minHeight: 48,
  },
  friendList: {
    gap: Spacing.md,
  },
  friendCard: {
    gap: Spacing.md,
  },
  friendCardDivider: {
    paddingTop: Spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(255, 255, 255, 0.12)',
  },
  friendTop: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.sm,
  },
  friendTopInner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
  },
  noShrink: {
    flexShrink: 0,
  },
  friendActionsStacked: {
    flexDirection: 'column',
    alignItems: 'stretch',
  },
  friendName: {
    fontFamily: 'Inter-Bold',
    fontSize: 16,
    lineHeight: 21,
    color: Colors.primary,
  },
  friendRecord: {
    fontFamily: 'Inter',
    fontSize: 12,
    color: 'rgba(255, 255, 255, 0.75)',
    marginTop: 3,
  },
  friendActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  flex1: {
    flex: 1,
  },
  wideButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    height: 44,
    paddingHorizontal: 12,
    borderRadius: BorderRadius.full,
  },
  wideButtonText: {
    fontFamily: 'Inter-Bold',
    fontSize: 14,
  },
  moreButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowInfoPress: {
    flex: 1,
    minWidth: 0,
  },
  rowInfo: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
  },
  rowText: {
    flex: 1,
    minWidth: 0,
  },
  rowName: {
    fontFamily: 'Inter-Bold',
    fontSize: 15,
    color: Colors.primary,
  },
  rowSub: {
    fontFamily: 'Inter',
    fontSize: 12,
    color: Colors.textSubtle,
    marginTop: 2,
  },
  rowActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  iconButton: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    minWidth: 84,
    paddingHorizontal: 14,
    height: 34,
    borderRadius: BorderRadius.full,
  },
  pillPrimary: {
    backgroundColor: '#ffffff',
  },
  pillMuted: {
    backgroundColor: 'rgba(255, 255, 255, 0.12)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.18)',
  },
  pillText: {
    fontFamily: 'Inter-Bold',
    fontSize: 13,
  },
  pillTextPrimary: {
    color: '#000000',
  },
  pillTextMuted: {
    color: '#ffffff',
  },
  pressed: {
    opacity: 0.8,
  },
  inlineSpinner: {
    marginTop: Spacing.md,
  },
  emptyBlock: {
    alignItems: 'center',
    gap: Spacing.sm,
    paddingVertical: Spacing.md,
  },
  emptyText: {
    fontFamily: 'Inter',
    fontSize: 13,
    color: Colors.textSubtle,
    textAlign: 'center',
    marginTop: Spacing.md,
  },
  errorText: {
    fontFamily: 'Inter',
    fontSize: 13,
    color: Colors.incorrect,
    marginTop: Spacing.md,
  },
  noticeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  noticeText: {
    flex: 1,
    fontFamily: 'Inter',
    fontSize: 13,
    color: Colors.primary,
  },
});
