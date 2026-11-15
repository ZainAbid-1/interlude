import React, { useCallback, useMemo, useState } from 'react';
import {
  View,
  Text,
  Image,
  Pressable,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  RefreshControl,
} from 'react-native';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import Animated, { FadeInDown, ZoomIn } from 'react-native-reanimated';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { GlassCard } from '../../components/GlassCard';
import { AlbumCollageBackground } from '../../components/AlbumCollageBackground';
import { PlayerAvatar } from '../../components/PlayerAvatar';
import { Colors, Spacing, BorderRadius } from '../../constants/theme';
import { useAuthStore } from '../../store/authStore';
import { Friend, listFriends } from '../../services/friends';
import {
  ArtistBattle,
  H2HMatch,
  H2HSummary,
  headToHead,
  summarizeHeadToHead,
} from '../../services/invites';

/**
 * You vs a friend: overall score, streaks, the artists you've battled over,
 * highlights and recent matches — plus a one-tap Challenge.
 */
export default function FriendHeadToHead() {
  const insets = useSafeAreaInsets();
  const { id } = useLocalSearchParams<{ id: string }>();
  const me = useAuthStore((s) => s.profile);

  const [friend, setFriend] = useState<Friend | null>(null);
  const [matches, setMatches] = useState<H2HMatch[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!id) return;
    const [f, h] = await Promise.all([listFriends(), headToHead(id)]);
    if (f.error || h.error) setError(f.error ?? h.error ?? null);
    else setError(null);
    setFriend((f.data ?? []).find((x) => x.id === id) ?? null);
    setMatches(h.data ?? []);
    setLoading(false);
  }, [id]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const s = useMemo(() => summarizeHeadToHead(matches), [matches]);

  const theirName = friend?.display_name?.split(' ')[0] || (friend ? `@${friend.username}` : 'Them');
  const myName = 'You';

  const challenge = () => {
    if (!friend) return;
    router.navigate({
      pathname: '/(tabs)',
      params: { challenge: friend.id, challengeName: friend.display_name || `@${friend.username}` },
    });
  };

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      <AlbumCollageBackground />

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 110 }]}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            tintColor="#ffffff"
            onRefresh={async () => {
              setRefreshing(true);
              await load();
              setRefreshing(false);
            }}
          />
        }
      >
        <View style={styles.topBar}>
          <Pressable onPress={() => router.back()} hitSlop={10}>
            <View style={styles.backButton}>
              <Ionicons name="chevron-back" size={22} color={Colors.primary} />
            </View>
          </Pressable>
          <Text style={styles.topTitle}>Head to head</Text>
          <View style={{ width: 40 }} />
        </View>

        {loading ? (
          <ActivityIndicator color="#ffffff" style={{ marginTop: Spacing.xl }} />
        ) : error ? (
          <GlassCard borderRadius={24}>
            <Text style={styles.errorText}>{error}</Text>
          </GlassCard>
        ) : (
          <>
            {/* Hero: you vs them */}
            <Animated.View entering={FadeInDown.delay(80).duration(500)}>
              <GlassCard borderRadius={24}>
                <View style={styles.vsRow}>
                  <View style={styles.vsSide}>
                    <PlayerAvatar uri={me?.avatar_url} name={me?.display_name ?? me?.username} size={64} />
                    <Text style={styles.vsName} numberOfLines={1}>{myName}</Text>
                  </View>

                  <Animated.View entering={ZoomIn.delay(250).duration(400)} style={styles.scoreBlock}>
                    <Text style={styles.bigScore}>
                      <Text style={s.wins >= s.losses ? styles.bigScoreLead : undefined}>{s.wins}</Text>
                      <Text style={styles.bigScoreDash}> – </Text>
                      <Text style={s.losses > s.wins ? styles.bigScoreLead : undefined}>{s.losses}</Text>
                    </Text>
                    <Text style={styles.scoreCaption}>
                      {s.played === 0
                        ? 'No matches yet'
                        : `${s.played} ${s.played === 1 ? 'match' : 'matches'}${s.draws ? ` · ${s.draws} draw${s.draws > 1 ? 's' : ''}` : ''}`}
                    </Text>
                  </Animated.View>

                  <View style={styles.vsSide}>
                    <PlayerAvatar uri={friend?.avatar_url} name={theirName} size={64} />
                    <Text style={styles.vsName} numberOfLines={1}>{theirName}</Text>
                  </View>
                </View>

                {s.played > 0 ? (
                  <View style={styles.chipRow}>
                    <Chip text={verdict(s, theirName)} strong />
                    {streakText(s, theirName) ? (
                      <Chip
                        text={streakText(s, theirName)!}
                        icon={s.streak?.who === 'me' ? 'fire' : 'lightning-bolt'}
                      />
                    ) : null}
                  </View>
                ) : (
                  <Text style={styles.emptyHero}>
                    Your rivalry starts with one match. Challenge {theirName} and pick an artist.
                  </Text>
                )}
              </GlassCard>
            </Animated.View>

            {/* Artists battled over */}
            {s.artists.length > 0 ? (
              <Animated.View entering={FadeInDown.delay(180).duration(500)}>
                <GlassCard borderRadius={24}>
                  <Text style={styles.sectionTitle}>Artists you've battled over</Text>
                  <ScrollView
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    style={styles.artistScroll}
                    contentContainerStyle={styles.artistScrollContent}
                  >
                    {s.artists.map((a) => (
                      <ArtistCard key={a.artist} battle={a} theirName={theirName} />
                    ))}
                  </ScrollView>
                </GlassCard>
              </Animated.View>
            ) : null}

            {/* Highlights */}
            {s.played > 0 ? (
              <Animated.View entering={FadeInDown.delay(260).duration(500)}>
                <GlassCard borderRadius={24}>
                  <Text style={styles.sectionTitle}>Highlights</Text>
                  <View style={styles.grid}>
                    {s.biggestWin ? (
                      <Highlight
                        icon="trophy-outline"
                        label="Biggest win"
                        value={`+${s.biggestWin.my_score - (s.biggestWin.their_score ?? 0)}`}
                        sub={s.biggestWin.artist_name}
                      />
                    ) : null}
                    {s.closest ? (
                      <Highlight
                        icon="sword-cross"
                        label="Closest match"
                        value={`${s.closest.my_score}–${s.closest.their_score ?? 0}`}
                        sub={s.closest.artist_name}
                      />
                    ) : null}
                    {s.myBestArtist ? (
                      <Highlight
                        icon="crown-outline"
                        label="Your turf"
                        value={s.myBestArtist.artist}
                        sub={`${s.myBestArtist.wins} ${s.myBestArtist.wins === 1 ? 'win' : 'wins'}`}
                      />
                    ) : null}
                    {s.theirBestArtist ? (
                      <Highlight
                        icon="shield-alert-outline"
                        label={`${theirName}'s turf`}
                        value={s.theirBestArtist.artist}
                        sub={`${s.theirBestArtist.losses} ${s.theirBestArtist.losses === 1 ? 'win' : 'wins'} for them`}
                      />
                    ) : null}
                    <Highlight
                      icon="music-note-outline"
                      label="Songs guessed"
                      value={`${s.totalCorrect.me}–${s.totalCorrect.them}`}
                      sub={`You vs ${theirName}`}
                    />
                    {s.lastPlayed ? (
                      <Highlight
                        icon="calendar-clock"
                        label="Last played"
                        value={timeAgo(s.lastPlayed)}
                        sub={s.artists[0] ? `Most played: ${s.artists[0].artist}` : ''}
                      />
                    ) : null}
                  </View>
                </GlassCard>
              </Animated.View>
            ) : null}

            {/* Recent matches */}
            {matches.length > 0 ? (
              <Animated.View entering={FadeInDown.delay(340).duration(500)}>
                <GlassCard borderRadius={24}>
                  <Text style={styles.sectionTitle}>Recent matches</Text>
                  <View style={styles.matchList}>
                    {matches.slice(0, 10).map((m) => (
                      <MatchRow key={m.room_id} match={m} />
                    ))}
                  </View>
                </GlassCard>
              </Animated.View>
            ) : null}
          </>
        )}
      </ScrollView>

      {/* Sticky challenge */}
      {friend ? (
        <View style={[styles.stickyBar, { paddingBottom: insets.bottom + Spacing.md }]}>
          <Pressable onPress={challenge}>
            <View style={styles.challengeButton}>
              <Ionicons name="flash" size={18} color="#000000" />
              <Text style={styles.challengeText}>
                {s.played === 0 ? `Challenge ${theirName}` : s.losses > s.wins ? 'Get your revenge' : `Challenge ${theirName}`}
              </Text>
            </View>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

// ─── Copy ────────────────────────────────────────────────────────────────

function verdict(s: H2HSummary, them: string): string {
  if (s.wins > s.losses) return s.wins - s.losses >= 3 ? `You own this rivalry` : `You lead the rivalry`;
  if (s.losses > s.wins) return s.losses - s.wins >= 3 ? `${them} owns this rivalry` : `${them} leads the rivalry`;
  return `Dead even`;
}

function streakText(s: H2HSummary, them: string): string | null {
  if (!s.streak || s.streak.count < 2) return null;
  if (s.streak.who === 'me') return `You've won ${s.streak.count} in a row`;
  if (s.streak.who === 'them') return `${them} has won ${s.streak.count} straight`;
  return `${s.streak.count} draws in a row`;
}

function timeAgo(iso: string): string {
  const diff = Date.now() - Date.parse(iso);
  const day = 86400000;
  if (diff < 60 * 60 * 1000) return 'Just now';
  if (diff < day) return 'Today';
  if (diff < 2 * day) return 'Yesterday';
  if (diff < 7 * day) return `${Math.floor(diff / day)} days ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

// ─── Pieces ──────────────────────────────────────────────────────────────

function Chip({
  text,
  strong,
  icon,
}: {
  text: string;
  strong?: boolean;
  icon?: React.ComponentProps<typeof MaterialCommunityIcons>['name'];
}) {
  return (
    <View style={[styles.chip, strong && styles.chipStrong]}>
      {icon ? (
        <MaterialCommunityIcons name={icon} size={13} color={strong ? '#000000' : '#ffffff'} />
      ) : null}
      <Text style={[styles.chipText, strong && styles.chipTextStrong]} numberOfLines={1}>
        {text}
      </Text>
    </View>
  );
}

function ArtistCard({ battle, theirName }: { battle: ArtistBattle; theirName: string }) {
  const lead =
    battle.wins > battle.losses ? 'You lead' : battle.losses > battle.wins ? `${theirName} leads` : 'Tied';
  return (
    <View style={styles.artistCard}>
      {battle.image ? (
        <Image source={{ uri: battle.image }} style={styles.artistImage} resizeMethod="resize" />
      ) : (
        <View style={[styles.artistImage, styles.artistImageFallback]}>
          <Ionicons name="musical-notes" size={28} color={Colors.textSubtle} />
        </View>
      )}
      <Text style={styles.artistName} numberOfLines={1}>
        {battle.artist}
      </Text>
      <Text style={styles.artistRecord}>
        {battle.wins}–{battle.losses}
        {battle.draws ? `–${battle.draws}` : ''} · {battle.played}×
      </Text>
      <Text
        style={[
          styles.artistLead,
          battle.wins > battle.losses && { color: Colors.correct },
          battle.losses > battle.wins && { color: Colors.incorrect },
        ]}
        numberOfLines={1}
      >
        {lead}
      </Text>
    </View>
  );
}

function Highlight({
  icon,
  label,
  value,
  sub,
}: {
  icon: React.ComponentProps<typeof MaterialCommunityIcons>['name'];
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <View style={styles.highlight}>
      <MaterialCommunityIcons name={icon} size={18} color={Colors.textSubtle} />
      <Text style={styles.highlightLabel} numberOfLines={1}>
        {label}
      </Text>
      <Text style={styles.highlightValue} numberOfLines={1}>
        {value}
      </Text>
      {sub ? (
        <Text style={styles.highlightSub} numberOfLines={1}>
          {sub}
        </Text>
      ) : null}
    </View>
  );
}

function MatchRow({ match }: { match: H2HMatch }) {
  const tone =
    match.outcome === 'win' ? Colors.correct : match.outcome === 'loss' ? Colors.incorrect : Colors.textSubtle;
  const label = match.outcome === 'win' ? 'W' : match.outcome === 'loss' ? 'L' : 'D';
  return (
    <View style={styles.matchRow}>
      {match.artist_image_url ? (
        <Image source={{ uri: match.artist_image_url }} style={styles.matchImage} resizeMethod="resize" />
      ) : (
        <View style={[styles.matchImage, styles.artistImageFallback]}>
          <Ionicons name="musical-notes" size={16} color={Colors.textSubtle} />
        </View>
      )}
      <View style={styles.matchText}>
        <Text style={styles.matchArtist} numberOfLines={1}>
          {match.artist_name}
        </Text>
        <Text style={styles.matchWhen}>{timeAgo(match.played_at)}</Text>
      </View>
      <Text style={styles.matchScore}>
        {match.my_score}–{match.their_score ?? '?'}
      </Text>
      <View style={[styles.outcomeBadge, { borderColor: tone }]}>
        <Text style={[styles.outcomeText, { color: tone }]}>{label}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  content: {
    padding: Spacing.containerPadding,
    gap: Spacing.md,
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: Spacing.sm,
  },
  backButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  topTitle: {
    fontFamily: 'Antonio',
    fontSize: 26,
    letterSpacing: 2,
    textTransform: 'uppercase',
    color: '#ffffff',
    textShadowColor: 'rgba(0, 0, 0, 0.95)',
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 8,
  },
  errorText: {
    fontFamily: 'Inter',
    fontSize: 14,
    color: Colors.incorrect,
  },
  vsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  vsSide: {
    width: 84,
    alignItems: 'center',
    gap: 6,
  },
  vsName: {
    fontFamily: 'Inter-Bold',
    fontSize: 13,
    color: '#ffffff',
    maxWidth: 84,
  },
  scoreBlock: {
    flex: 1,
    alignItems: 'center',
  },
  bigScore: {
    fontFamily: 'Antonio',
    fontSize: 54,
    lineHeight: 62,
    color: 'rgba(255, 255, 255, 0.55)',
  },
  bigScoreLead: {
    color: '#ffffff',
  },
  bigScoreDash: {
    color: 'rgba(255, 255, 255, 0.35)',
  },
  scoreCaption: {
    fontFamily: 'Inter',
    fontSize: 12,
    color: Colors.textSubtle,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: Spacing.sm,
    marginTop: Spacing.md,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: BorderRadius.full,
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.18)',
  },
  chipStrong: {
    backgroundColor: '#ffffff',
    borderColor: '#ffffff',
  },
  chipText: {
    fontFamily: 'Inter-Bold',
    fontSize: 12,
    color: '#ffffff',
  },
  chipTextStrong: {
    color: '#000000',
  },
  emptyHero: {
    fontFamily: 'Inter',
    fontSize: 13,
    color: Colors.textSubtle,
    textAlign: 'center',
    marginTop: Spacing.md,
  },
  sectionTitle: {
    fontFamily: 'Inter-Bold',
    fontSize: 15,
    color: Colors.primary,
    marginBottom: Spacing.md,
  },
  artistScroll: {
    marginHorizontal: -Spacing.containerPadding,
  },
  artistScrollContent: {
    gap: Spacing.sm,
    paddingHorizontal: Spacing.containerPadding,
  },
  artistCard: {
    width: 112,
    gap: 3,
  },
  artistImage: {
    width: 112,
    height: 112,
    borderRadius: BorderRadius.lg,
    backgroundColor: Colors.surfaceContainer,
    marginBottom: 4,
  },
  artistImageFallback: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  artistName: {
    fontFamily: 'Inter-Bold',
    fontSize: 13,
    color: '#ffffff',
  },
  artistRecord: {
    fontFamily: 'Inter',
    fontSize: 12,
    color: Colors.textSubtle,
  },
  artistLead: {
    fontFamily: 'Inter-Bold',
    fontSize: 11,
    color: Colors.textSubtle,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.sm,
  },
  highlight: {
    width: '48%',
    flexGrow: 1,
    padding: Spacing.md,
    borderRadius: BorderRadius.lg,
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
    borderWidth: 1,
    borderColor: Colors.glassBorder,
    gap: 2,
  },
  highlightLabel: {
    fontFamily: 'Inter',
    fontSize: 12,
    color: Colors.textSubtle,
    marginTop: 4,
  },
  highlightValue: {
    fontFamily: 'Inter-Bold',
    fontSize: 18,
    color: '#ffffff',
  },
  highlightSub: {
    fontFamily: 'Inter',
    fontSize: 11,
    color: Colors.textMuted,
  },
  matchList: {
    gap: Spacing.md,
  },
  matchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
  },
  matchImage: {
    width: 40,
    height: 40,
    borderRadius: BorderRadius.md,
    backgroundColor: Colors.surfaceContainer,
  },
  matchText: {
    flex: 1,
    minWidth: 0,
  },
  matchArtist: {
    fontFamily: 'Inter-Bold',
    fontSize: 14,
    color: '#ffffff',
  },
  matchWhen: {
    fontFamily: 'Inter',
    fontSize: 12,
    color: Colors.textSubtle,
    marginTop: 1,
  },
  matchScore: {
    fontFamily: 'Inter-Bold',
    fontSize: 14,
    color: '#ffffff',
  },
  outcomeBadge: {
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  outcomeText: {
    fontFamily: 'Inter-Bold',
    fontSize: 12,
  },
  stickyBar: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: Spacing.containerPadding,
    paddingTop: Spacing.md,
    backgroundColor: 'rgba(10, 10, 10, 0.85)',
  },
  challengeButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.sm,
    height: 52,
    borderRadius: BorderRadius.lg,
    backgroundColor: '#ffffff',
  },
  challengeText: {
    fontFamily: 'Inter-Bold',
    fontSize: 16,
    color: '#000000',
  },
});
