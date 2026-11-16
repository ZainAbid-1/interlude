import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  Pressable,
  StyleSheet,
  ScrollView,
  Image,
  ActivityIndicator,
  RefreshControl,
} from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { GlassCard } from '../../components/GlassCard';
import { AlbumCollageBackground } from '../../components/AlbumCollageBackground';
import { PlayerAvatar } from '../../components/PlayerAvatar';
import { Colors, Spacing, BorderRadius } from '../../constants/theme';
import {
  LeaderboardArtist,
  LeaderboardRow,
  Period,
  Scope,
  getLeaderboard,
  listLeaderboardArtists,
} from '../../services/leaderboard';

const fmt = (n: number) => n.toLocaleString('en-US');
const secs = (ms: number | null) => (ms == null ? '-' : `${(ms / 1000).toFixed(1)}s`);
const nameOf = (r: LeaderboardRow) => r.display_name || (r.username ? `@${r.username}` : 'Player');

export default function LeaderboardScreen() {
  const insets = useSafeAreaInsets();

  const [scope, setScope] = useState<Scope>('friends');
  const [period, setPeriod] = useState<Period>('all');
  const [artistKey, setArtistKey] = useState<string | null>(null);

  const [artists, setArtists] = useState<LeaderboardArtist[]>([]);
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [searchResults, setSearchResults] = useState<LeaderboardArtist[] | null>(null);
  // Keeps a searched artist visible as a chip after the search closes.
  const [pinnedArtist, setPinnedArtist] = useState<LeaderboardArtist | null>(null);

  const [rows, setRows] = useState<LeaderboardRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Replies for an old selection are dropped (fast chip tapping).
  const boardReq = useRef(0);
  const searchReq = useRef(0);

  const loadArtists = useCallback(async () => {
    const res = await listLeaderboardArtists(period);
    if (res.data) setArtists(res.data);
  }, [period]);

  const loadBoard = useCallback(async () => {
    const id = ++boardReq.current;
    setError(null);
    const res = await getLeaderboard(artistKey, scope, period);
    if (id !== boardReq.current) return;
    if (res.error) {
      setError(res.error);
      setRows([]);
    } else {
      setRows(res.data ?? []);
    }
    setLoading(false);
  }, [artistKey, scope, period]);

  useEffect(() => {
    setLoading(true);
    loadBoard();
  }, [loadBoard]);

  useEffect(() => {
    loadArtists();
  }, [loadArtists]);

  // Fresh numbers when coming back from a match.
  useFocusEffect(
    useCallback(() => {
      loadArtists();
      loadBoard();
    }, [loadArtists, loadBoard])
  );

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setSearchResults(null);
      return;
    }
    const id = ++searchReq.current;
    const t = setTimeout(async () => {
      const res = await listLeaderboardArtists(period, q);
      if (id === searchReq.current) setSearchResults(res.data ?? []);
    }, 300);
    return () => clearTimeout(t);
  }, [query, period]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await Promise.all([loadArtists(), loadBoard()]);
    setRefreshing(false);
  }, [loadArtists, loadBoard]);

  const pickArtist = (a: LeaderboardArtist | null) => {
    setArtistKey(a?.artist_key ?? null);
    if (a && !artists.some((x) => x.artist_key === a.artist_key)) setPinnedArtist(a);
    setSearchOpen(false);
    setQuery('');
  };

  const chipList: LeaderboardArtist[] = [
    ...(pinnedArtist && !artists.some((x) => x.artist_key === pinnedArtist.artist_key)
      ? [pinnedArtist]
      : []),
    ...artists,
  ];
  const selected = chipList.find((a) => a.artist_key === artistKey) ?? null;
  const me = rows.find((r) => r.is_me) ?? null;
  const others = rows.filter((r) => !r.is_me || r.rank <= rowsBeforeGap(rows));
  const pinnedMe = me && !others.includes(me) ? me : null;

  const myArtists = artists
    .filter((a) => a.my_matches > 0)
    .sort((a, b) => (b.my_best ?? 0) - (a.my_best ?? 0));

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      <AlbumCollageBackground />
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={[styles.scrollContent, { paddingBottom: insets.bottom + 100 }]}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#ffffff" />}
      >
        <Animated.View entering={FadeInDown.delay(100).duration(500)} style={styles.header}>
          <Text style={styles.headerTitle}>Leaderboard</Text>
        </Animated.View>

        {/* Scope + period */}
        <Animated.View entering={FadeInDown.delay(150).duration(500)} style={styles.controls}>
          <Segmented
            value={scope}
            onChange={setScope}
            options={[
              { value: 'friends', label: 'Friends', icon: 'people' },
              { value: 'global', label: 'Global', icon: 'globe-outline' },
            ]}
          />
          <Segmented
            small
            value={period}
            onChange={setPeriod}
            options={[
              { value: 'week', label: 'This week' },
              { value: 'all', label: 'All time' },
            ]}
          />
        </Animated.View>

        {/* Artist picker */}
        <Animated.View entering={FadeInDown.delay(200).duration(500)}>
          {searchOpen ? (
            <View>
              <View style={styles.searchBox}>
                <Ionicons name="search" size={16} color={Colors.textSubtle} />
                <TextInput
                  value={query}
                  onChangeText={setQuery}
                  placeholder="Search an artist"
                  placeholderTextColor={Colors.textMuted}
                  style={styles.searchInput}
                  autoFocus
                  autoCorrect={false}
                  returnKeyType="search"
                />
                <Pressable
                  onPress={() => {
                    setSearchOpen(false);
                    setQuery('');
                  }}
                  hitSlop={8}
                  accessibilityLabel="Close search"
                >
                  <Ionicons name="close" size={18} color="#ffffff" />
                </Pressable>
              </View>
              {searchResults ? (
                <View style={styles.searchResults}>
                  {searchResults.length === 0 ? (
                    <Text style={styles.mutedText}>No finished matches with that artist yet.</Text>
                  ) : (
                    searchResults.map((a) => (
                      <Pressable key={a.artist_key} onPress={() => pickArtist(a)}>
                        <View style={styles.searchRow}>
                          <ArtistImage uri={a.artist_image_url} name={a.artist_name} size={32} />
                          <Text style={styles.searchRowName} numberOfLines={1}>
                            {a.artist_name}
                          </Text>
                          <Text style={styles.mutedText}>
                            {a.matches} {a.matches === 1 ? 'match' : 'matches'}
                          </Text>
                        </View>
                      </Pressable>
                    ))
                  )}
                </View>
              ) : null}
            </View>
          ) : (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.chips}
            >
              <Pressable onPress={() => setSearchOpen(true)} accessibilityLabel="Search artists">
                <View style={styles.chip}>
                  <Ionicons name="search" size={15} color="#ffffff" />
                </View>
              </Pressable>
              <Chip label="All artists" active={artistKey === null} onPress={() => pickArtist(null)} />
              {chipList.map((a) => (
                <Chip
                  key={a.artist_key}
                  label={a.artist_name}
                  image={a.artist_image_url}
                  active={artistKey === a.artist_key}
                  onPress={() => pickArtist(a)}
                />
              ))}
            </ScrollView>
          )}
        </Animated.View>

        {/* Your artists */}
        <Animated.View entering={FadeInDown.delay(250).duration(500)}>
          <GlassCard borderRadius={24} padding={20}>
            {selected ? (
              <View style={styles.youRow}>
                <ArtistImage uri={selected.artist_image_url} name={selected.artist_name} size={52} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.cardTitle} numberOfLines={1}>
                    {selected.artist_name}
                  </Text>
                  <Text style={styles.youSub}>
                    {me
                      ? `Your best ${fmt(me.score)}  ·  #${me.rank} of ${me.total}`
                      : `You haven't finished a ${selected.artist_name} match${period === 'week' ? ' this week' : ''}`}
                  </Text>
                  <Text style={styles.mutedText}>
                    {selected.matches} {selected.matches === 1 ? 'match' : 'matches'} played by everyone
                  </Text>
                </View>
              </View>
            ) : myArtists.length > 0 ? (
              <View>
                <Text style={styles.cardTitle}>Your artists</Text>
                <Text style={styles.youSub}>
                  You know {myArtists[0].artist_name} best  ·  {myArtists.length}{' '}
                  {myArtists.length === 1 ? 'artist' : 'artists'} played
                </Text>
                <View style={styles.myArtists}>
                  {myArtists.slice(0, 3).map((a) => (
                    <Pressable key={a.artist_key} onPress={() => pickArtist(a)} style={{ flex: 1 }}>
                      <View style={styles.myArtist}>
                        <ArtistImage uri={a.artist_image_url} name={a.artist_name} size={44} />
                        <Text style={styles.myArtistName} numberOfLines={1}>
                          {a.artist_name}
                        </Text>
                        <Text style={styles.myArtistScore}>{fmt(a.my_best ?? 0)}</Text>
                      </View>
                    </Pressable>
                  ))}
                </View>
              </View>
            ) : (
              <View>
                <Text style={styles.cardTitle}>Your artists</Text>
                <Text style={styles.youSub}>
                  Finish a match to see which artists you know best.
                </Text>
              </View>
            )}
          </GlassCard>
        </Animated.View>

        {/* Board */}
        <Animated.View entering={FadeInDown.delay(300).duration(500)}>
          <GlassCard borderRadius={24} padding={0}>
            <View style={styles.boardHeader}>
              <Text style={styles.cardTitle}>
                {selected ? `Best scores · ${selected.artist_name}` : 'Most wins · All artists'}
              </Text>
              <Text style={styles.mutedText}>
                {selected ? 'Best single match' : 'Win rate from 5 matches'}
              </Text>
            </View>

            {loading ? (
              <ActivityIndicator color="#ffffff" style={{ marginVertical: Spacing.lg }} />
            ) : error ? (
              <Text style={[styles.mutedText, styles.empty]}>{error}</Text>
            ) : rows.length === 0 || (scope === 'friends' && rows.every((r) => r.is_me)) ? (
              <View style={styles.emptyBlock}>
                <Ionicons name="trophy-outline" size={32} color={Colors.textMuted} />
                <Text style={styles.emptyText}>{emptyText(scope, period, selected?.artist_name)}</Text>
                {rows.length > 0 ? <Row row={rows[0]} perArtist={!!selected} /> : null}
              </View>
            ) : (
              <View>
                {others.map((r) => (
                  <Row key={r.player_id} row={r} perArtist={!!selected} />
                ))}
                {pinnedMe ? (
                  <>
                    <View style={styles.gap}>
                      <View style={styles.gapLine} />
                      <Text style={styles.mutedText}>Your spot</Text>
                      <View style={styles.gapLine} />
                    </View>
                    <Row row={pinnedMe} perArtist={!!selected} />
                  </>
                ) : null}
              </View>
            )}
          </GlassCard>
        </Animated.View>
      </ScrollView>
    </View>
  );
}

/** Your row sits in the list unless the server added it after the top cut. */
function rowsBeforeGap(rows: LeaderboardRow[]): number {
  const top = rows.filter((r) => !r.is_me);
  const lastTop = top.length ? top[top.length - 1].rank : 0;
  return Math.max(lastTop, top.length + 1);
}

function emptyText(scope: Scope, period: Period, artist?: string) {
  const when = period === 'week' ? ' this week' : '';
  if (scope === 'friends') {
    return artist
      ? `None of your friends has finished a ${artist} match${when}. Challenge one from the Friends tab.`
      : `No finished matches with friends${when}. Challenge one from the Friends tab.`;
  }
  return artist ? `No finished ${artist} matches${when} yet.` : `No finished matches${when} yet.`;
}

function Row({ row, perArtist }: { row: LeaderboardRow; perArtist: boolean }) {
  const podium = row.rank <= 3;
  const winRate = row.matches >= 5 ? `${Math.round((row.wins * 100) / row.matches)}%` : null;
  const content = (
    <View style={[styles.row, row.is_me && styles.rowMe]}>
      <View style={[styles.rank, podium && styles.rankPodium]}>
        <Text style={[styles.rankText, podium && styles.rankTextPodium]}>{row.rank}</Text>
      </View>
      <PlayerAvatar uri={row.avatar_url} name={row.display_name || row.username} size={40} />
      <View style={{ flex: 1 }}>
        <Text style={styles.rowName} numberOfLines={1}>
          {nameOf(row)}
          {row.is_me ? '  (you)' : ''}
        </Text>
        <Text style={styles.mutedText} numberOfLines={1}>
          {row.username ? `@${row.username}` : ''}
          {row.is_friend ? '  ·  Head to head' : ''}
        </Text>
      </View>
      <View style={styles.rowRight}>
        {perArtist ? (
          <>
            <Text style={styles.rowScore}>{fmt(row.score)}</Text>
            <Text style={styles.mutedText}>
              {row.correct} right · {secs(row.avg_ms)}
            </Text>
          </>
        ) : (
          <>
            <Text style={styles.rowScore}>
              {row.wins} {row.wins === 1 ? 'win' : 'wins'}
            </Text>
            <Text style={styles.mutedText}>
              {row.matches} played{winRate ? ` · ${winRate}` : ''}
            </Text>
          </>
        )}
      </View>
    </View>
  );
  if (!row.is_friend) return content;
  return (
    <Pressable
      onPress={() => router.push(`/friend/${row.player_id}`)}
      accessibilityLabel={`Head to head with ${nameOf(row)}`}
    >
      {content}
    </Pressable>
  );
}

function Segmented<T extends string>({
  value,
  onChange,
  options,
  small,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string; icon?: keyof typeof Ionicons.glyphMap }[];
  small?: boolean;
}) {
  return (
    <View style={[styles.segmented, small && styles.segmentedSmall]}>
      {options.map((o) => {
        const active = o.value === value;
        return (
          <Pressable key={o.value} onPress={() => onChange(o.value)} style={{ flex: 1 }}>
            <View style={[styles.segment, small && styles.segmentSmall, active && styles.segmentActive]}>
              {o.icon ? <Ionicons name={o.icon} size={15} color={active ? '#0a0a0a' : '#ffffff'} /> : null}
              <Text
                style={[styles.segmentText, small && styles.segmentTextSmall, active && styles.segmentTextActive]}
              >
                {o.label}
              </Text>
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}

function Chip({
  label,
  image,
  active,
  onPress,
}: {
  label: string;
  image?: string | null;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable onPress={onPress}>
      <View style={[styles.chip, active && styles.chipActive]}>
        {image !== undefined ? <ArtistImage uri={image} name={label} size={24} /> : null}
        <Text style={[styles.chipText, active && styles.chipTextActive]} numberOfLines={1}>
          {label}
        </Text>
      </View>
    </Pressable>
  );
}

function ArtistImage({ uri, name, size }: { uri: string | null; name: string; size: number }) {
  if (!uri) return <PlayerAvatar name={name} size={size} />;
  return (
    <Image
      source={{ uri }}
      resizeMethod="resize"
      style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: Colors.surfaceContainerHigh }}
    />
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: Colors.background },
  scrollContent: { padding: Spacing.containerPadding, gap: Spacing.md },
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
  controls: { gap: Spacing.sm },
  segmented: {
    flexDirection: 'row',
    padding: 4,
    gap: 4,
    borderRadius: BorderRadius.full,
    backgroundColor: 'rgba(20, 20, 20, 0.75)',
    borderWidth: 1,
    borderColor: Colors.glassBorder,
  },
  segmentedSmall: { alignSelf: 'flex-start', minWidth: 220 },
  segment: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 10,
    borderRadius: BorderRadius.full,
  },
  segmentSmall: { paddingVertical: 6, paddingHorizontal: 12 },
  segmentActive: { backgroundColor: '#ffffff' },
  segmentText: { fontFamily: 'Inter-Bold', fontSize: 14, color: '#ffffff' },
  segmentTextSmall: { fontSize: 12 },
  segmentTextActive: { color: '#0a0a0a' },
  chips: { gap: Spacing.sm, paddingRight: Spacing.md },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    height: 38,
    paddingHorizontal: 14,
    borderRadius: BorderRadius.full,
    backgroundColor: 'rgba(20, 20, 20, 0.75)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.2)',
    maxWidth: 200,
  },
  chipActive: { backgroundColor: '#ffffff', borderColor: '#ffffff' },
  chipText: { fontFamily: 'Inter-Bold', fontSize: 13, color: '#ffffff', flexShrink: 1 },
  chipTextActive: { color: '#0a0a0a' },
  searchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    height: 44,
    paddingHorizontal: 14,
    borderRadius: BorderRadius.full,
    backgroundColor: 'rgba(20, 20, 20, 0.85)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.25)',
  },
  searchInput: { flex: 1, fontFamily: 'Inter', fontSize: 15, color: '#ffffff', paddingVertical: 0 },
  searchResults: {
    marginTop: Spacing.sm,
    padding: Spacing.sm,
    gap: 2,
    borderRadius: 20,
    backgroundColor: 'rgba(20, 20, 20, 0.9)',
    borderWidth: 1,
    borderColor: Colors.glassBorder,
  },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    paddingVertical: 8,
    paddingHorizontal: 6,
  },
  searchRowName: { flex: 1, fontFamily: 'Inter-Bold', fontSize: 14, color: '#ffffff' },
  cardTitle: { fontFamily: 'Inter-Bold', fontSize: 15, color: Colors.primary },
  youRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  youSub: { fontFamily: 'Inter', fontSize: 13, color: Colors.textSubtle, marginTop: 2, marginBottom: 2 },
  myArtists: { flexDirection: 'row', gap: Spacing.sm, marginTop: Spacing.md },
  myArtist: {
    alignItems: 'center',
    gap: 6,
    paddingVertical: 12,
    paddingHorizontal: 6,
    borderRadius: 16,
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
  },
  myArtistName: { fontFamily: 'Inter-Bold', fontSize: 12, color: '#ffffff', maxWidth: '100%' },
  myArtistScore: { fontFamily: 'Inter', fontSize: 12, color: Colors.textSubtle },
  boardHeader: { paddingHorizontal: 20, paddingTop: 20, paddingBottom: 12, gap: 2 },
  mutedText: { fontFamily: 'Inter', fontSize: 12, color: Colors.textMuted },
  empty: { paddingHorizontal: 20, paddingBottom: 20 },
  emptyBlock: { alignItems: 'stretch', gap: Spacing.sm, paddingHorizontal: 20, paddingBottom: 20 },
  emptyText: { fontFamily: 'Inter', fontSize: 13, color: Colors.textSubtle, textAlign: 'center' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255, 255, 255, 0.06)',
  },
  rowMe: { backgroundColor: 'rgba(255, 255, 255, 0.1)' },
  rank: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rankPodium: { backgroundColor: '#ffffff' },
  rankText: { fontFamily: 'Inter-Bold', fontSize: 13, color: Colors.textSubtle },
  rankTextPodium: { color: '#0a0a0a' },
  rowName: { fontFamily: 'Inter-Bold', fontSize: 14, color: '#ffffff' },
  rowRight: { alignItems: 'flex-end' },
  rowScore: { fontFamily: 'Inter-Bold', fontSize: 16, color: '#ffffff' },
  gap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    paddingHorizontal: 16,
    paddingVertical: 6,
  },
  gapLine: { flex: 1, height: 1, backgroundColor: 'rgba(255, 255, 255, 0.12)' },
});
