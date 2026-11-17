import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { router } from 'expo-router';
import Animated, {
  FadeInDown,
  FadeInUp,
  ZoomIn,
} from 'react-native-reanimated';
import { MaterialCommunityIcons, Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { GlassCard } from '../components/GlassCard';
import { useGameStore } from '../store/gameStore';
import { useRoomStore } from '../store/roomStore';
import { useInviteStore } from '../store/inviteStore';
import {
  Relation,
  listFriends,
  respondFriendRequest,
  sendFriendRequest,
} from '../services/friends';
import { Colors, Spacing, BorderRadius } from '../constants/theme';

export default function ResultsScreen() {
  const insets = useSafeAreaInsets();
  const {
    playerScore,
    opponentScore,
    playerCorrectCount,
    opponentCorrectCount,
    totalRounds,
    roundResults,
    artistName,
    resetGame,
    opponentId,
    myRating,
    myRatingChange,
  } = useGameStore();

  const playerWins = playerScore > opponentScore;
  const isDraw = playerScore === opponentScore;

  /**
   * The match is over: clear the game AND the room (its code and artist live
   * in the room store, which Home reads), so Home starts fresh for both
   * players instead of showing the finished room's code.
   */
  const leaveResults = () => {
    useRoomStore.getState().resetRoom();
    useInviteStore.getState().cancelOutgoing();
    router.replace('/');
    setTimeout(resetGame, 300);
  };
  const handlePlayAgain = leaveResults;

  const outcomeIcon: React.ComponentProps<typeof MaterialCommunityIcons>['name'] = isDraw
    ? 'handshake-outline'
    : playerWins
      ? 'trophy-outline'
      : 'close-circle-outline';
  const outcomeText = isDraw
    ? "It's a Draw!"
    : playerWins
    ? 'You Win!'
    : 'You Lost!';

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      <ScrollView
        contentContainerStyle={[
          styles.scrollContent,
          { paddingBottom: insets.bottom + 40 },
        ]}
        showsVerticalScrollIndicator={false}
      >
        {/* Outcome */}
        <Animated.View
          entering={ZoomIn.delay(200).duration(500)}
          style={styles.outcomeSection}
        >
          <View style={styles.outcomeIcon}>
            <MaterialCommunityIcons name={outcomeIcon} size={48} color={Colors.primary} />
          </View>
          <Text style={styles.outcomeText}>{outcomeText}</Text>
          <Text style={styles.outcomeSubtext}>
            {artistName} — {totalRounds} Rounds
          </Text>
        </Animated.View>

        {/* Score Comparison */}
        <Animated.View entering={FadeInDown.delay(400).duration(500)}>
          <GlassCard borderRadius={24}>
            <View style={styles.scoreRow}>
              <View style={styles.scorePlayerBlock}>
                <Text style={styles.scorePlayerLabel}>You</Text>
                <Text style={styles.scorePlayerValue}>{playerScore}</Text>
                <Text style={styles.scorePlayerStat}>
                  {playerCorrectCount}/{totalRounds} correct
                </Text>
              </View>
              <View style={styles.vsContainer}>
                <Text style={styles.vsText}>VS</Text>
              </View>
              <View style={styles.scorePlayerBlock}>
                <Text style={styles.scorePlayerLabel}>Opponent</Text>
                <Text style={styles.scorePlayerValueOpp}>
                  {opponentScore}
                </Text>
                <Text style={styles.scorePlayerStat}>
                  {opponentCorrectCount}/{totalRounds} correct
                </Text>
              </View>
            </View>
            {myRating != null ? (
              <View style={styles.ratingRow}>
                <Text style={styles.ratingLabel}>Rating</Text>
                <Text style={styles.ratingValue}>{myRating.toLocaleString('en-US')}</Text>
                {myRatingChange != null && myRatingChange !== 0 ? (
                  <Text
                    style={[
                      styles.ratingChange,
                      { color: myRatingChange > 0 ? Colors.correct : Colors.incorrect },
                    ]}
                  >
                    {myRatingChange > 0 ? `+${myRatingChange}` : `${myRatingChange}`}
                  </Text>
                ) : null}
              </View>
            ) : null}
          </GlassCard>
        </Animated.View>

        {/* Round Breakdown */}
        <Animated.View entering={FadeInDown.delay(550).duration(500)}>
          <Text style={styles.sectionTitle}>Round Breakdown</Text>
          <View style={styles.roundsList}>
            {roundResults.map((result, index) => (
              <Animated.View
                key={index}
                entering={FadeInDown.delay(600 + index * 60).duration(300)}
              >
                <GlassCard borderRadius={16} padding={16}>
                  <View style={styles.roundRow}>
                    <View style={styles.roundLeft}>
                      <Text style={styles.roundIndex}>R{result.roundIndex}</Text>
                      <View style={{ flex: 1, paddingRight: 8 }}>
                        <Text style={styles.roundAnswer}>
                          {result.playerAnswer || 'No answer'}
                        </Text>
                      </View>
                    </View>
                    <View style={styles.roundRight}>
                      <View style={styles.roundScoreRow}>
                        <MaterialCommunityIcons
                          name={
                            result.playerCorrect
                              ? 'check-circle'
                              : 'close-circle'
                          }
                          size={16}
                          color={
                            result.playerCorrect
                              ? Colors.correct
                              : Colors.incorrect
                          }
                        />
                        <Text style={styles.roundPts}>
                          +{result.playerPoints}
                        </Text>
                      </View>
                    </View>
                  </View>
                </GlassCard>
              </Animated.View>
            ))}
          </View>
        </Animated.View>

        {/* Actions */}
        <Animated.View
          entering={FadeInDown.delay(800).duration(500)}
          style={styles.actions}
        >
          <Pressable style={styles.primaryButton} onPress={handlePlayAgain}>
            <MaterialCommunityIcons
              name="replay"
              size={20}
              color={Colors.background}
            />
            <Text style={styles.primaryButtonText}>Play Again</Text>
          </Pressable>
          {opponentId ? <AddFriendButton opponentId={opponentId} /> : null}
          <Pressable
            style={styles.secondaryButton}
            onPress={leaveResults}
          >
            <Text style={styles.secondaryButtonText}>Back to Home</Text>
          </Pressable>
        </Animated.View>
      </ScrollView>
    </View>
  );
}

/**
 * Add the opponent you just played. Starts from the real relationship so it
 * never offers "Add" to an existing friend, and accepts if they asked first.
 * Hidden when the friends feature isn't set up on the server.
 */
function AddFriendButton({ opponentId }: { opponentId: string }) {
  const [relation, setRelation] = useState<Relation | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    listFriends().then((res) => {
      if (cancelled || res.error) return;
      const row = (res.data ?? []).find((f) => f.id === opponentId);
      setRelation(row?.relation ?? 'none');
    });
    return () => {
      cancelled = true;
    };
  }, [opponentId]);

  if (!relation) return null;

  const onPress = async () => {
    if (relation === 'friend' || relation === 'outgoing') return;
    setBusy(true);
    const res =
      relation === 'incoming'
        ? await respondFriendRequest(opponentId, true)
        : await sendFriendRequest(opponentId);
    setBusy(false);
    if (res.error) Alert.alert('Could not add friend', res.error);
    else if (res.data) setRelation(res.data);
  };

  const label =
    relation === 'friend'
      ? 'Friends'
      : relation === 'outgoing'
        ? 'Friend request sent'
        : relation === 'incoming'
          ? 'Accept friend request'
          : 'Add as friend';
  const icon =
    relation === 'friend' || relation === 'outgoing' ? 'checkmark' : 'person-add-outline';

  return (
    <Pressable
      style={[styles.secondaryButton, styles.friendButton]}
      onPress={onPress}
      disabled={busy || relation === 'friend' || relation === 'outgoing'}
    >
      {busy ? (
        <ActivityIndicator size="small" color={Colors.primary} />
      ) : (
        <>
          <Ionicons name={icon} size={18} color={Colors.primary} />
          <Text style={[styles.secondaryButtonText, styles.friendButtonText]}>{label}</Text>
        </>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  friendButton: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 8,
  },
  friendButtonText: {
    color: Colors.primary,
  },
  screen: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  scrollContent: {
    padding: Spacing.containerPadding,
    gap: Spacing.lg,
  },

  // Outcome
  outcomeSection: {
    alignItems: 'center',
    paddingVertical: Spacing.xl,
  },
  outcomeIcon: {
    width: 96,
    height: 96,
    borderRadius: 48,
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.18)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: Spacing.md,
  },
  outcomeText: {
    fontFamily: 'Inter-Bold',
    fontSize: 32,
    color: Colors.primary,
    marginBottom: 4,
  },
  outcomeSubtext: {
    fontFamily: 'Inter',
    fontSize: 14,
    color: Colors.textSubtle,
  },

  // Scores
  scoreRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  scorePlayerBlock: {
    flex: 1,
    alignItems: 'center',
    gap: 4,
  },
  scorePlayerLabel: {
    fontFamily: 'Inter',
    fontSize: 12,
    color: Colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 1.5,
  },
  scorePlayerValue: {
    fontFamily: 'Inter-Bold',
    fontSize: 40,
    color: Colors.primary,
  },
  scorePlayerValueOpp: {
    fontFamily: 'Inter-Bold',
    fontSize: 40,
    color: Colors.textSubtle,
  },
  scorePlayerStat: {
    fontFamily: 'Inter',
    fontSize: 12,
    color: Colors.textMuted,
  },
  ratingRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'center',
    gap: 8,
    marginTop: Spacing.md,
    paddingTop: Spacing.md,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255, 255, 255, 0.08)',
  },
  ratingLabel: { fontFamily: 'Inter', fontSize: 13, color: Colors.textMuted },
  ratingValue: { fontFamily: 'Inter-Bold', fontSize: 18, color: Colors.primary },
  ratingChange: { fontFamily: 'Inter-Bold', fontSize: 14 },
  vsContainer: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.06)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  vsText: {
    fontFamily: 'Inter-Bold',
    fontSize: 12,
    color: Colors.textMuted,
    letterSpacing: 1,
  },

  // Rounds
  sectionTitle: {
    fontFamily: 'Inter-Bold',
    fontSize: 18,
    color: Colors.primary,
    marginBottom: 4,
  },
  roundsList: {
    gap: Spacing.sm,
  },
  roundRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  roundLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    flex: 1,
  },
  roundIndex: {
    fontFamily: 'Inter-Bold',
    fontSize: 13,
    color: Colors.textMuted,
    width: 28,
  },
  roundAnswer: {
    fontFamily: 'Inter',
    fontSize: 14,
    color: Colors.onSurface,
  },
  roundRight: {
    alignItems: 'flex-end',
  },
  roundScoreRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  roundPts: {
    fontFamily: 'Inter-Bold',
    fontSize: 14,
    color: Colors.onSurface,
  },

  // Actions
  actions: {
    gap: Spacing.stackGap,
    marginTop: Spacing.md,
  },
  primaryButton: {
    backgroundColor: Colors.primary,
    borderRadius: BorderRadius.lg,
    paddingVertical: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  primaryButtonText: {
    fontFamily: 'Inter-Bold',
    fontSize: 16,
    color: Colors.background,
  },
  secondaryButton: {
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderRadius: BorderRadius.lg,
    borderWidth: 1,
    borderColor: Colors.glassBorder,
    paddingVertical: 16,
    alignItems: 'center',
  },
  secondaryButtonText: {
    fontFamily: 'Inter-Bold',
    fontSize: 16,
    color: Colors.textSubtle,
  },
});
