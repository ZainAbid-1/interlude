import React, { useEffect, useRef, useState, useCallback } from 'react';
import {
  View,
  Text,
  Image,
  StyleSheet,
  Dimensions,
  Pressable,
  ActivityIndicator,
} from 'react-native';
import { router } from 'expo-router';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  withSequence,
  FadeIn,
  FadeInDown,
  FadeOut,
  ZoomIn,
} from 'react-native-reanimated';
import { MaterialCommunityIcons, Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { GlassCard } from '../components/GlassCard';
import { AnswerButton } from '../components/AnswerButton';
import { ProgressBar } from '../components/ProgressBar';
import { useGameStore, ROUND_DURATION_MS } from '../store/gameStore';
import { useRoomStore } from '../store/roomStore';
import { useClipPlayback } from '../hooks/useClipPlayback';
import { Colors, Spacing, BorderRadius } from '../constants/theme';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

type AnswerState = 'default' | 'selected' | 'correct' | 'incorrect' | 'dimmed';

export default function GameScreen() {
  const insets = useSafeAreaInsets();

  const roomId = useRoomStore((s) => s.roomId);
  const isHost = useRoomStore((s) => s.isHost);

  const {
    currentRoundIndex,
    totalRounds,
    currentRound,
    roundState,
    countdownValue,
    selectedAnswer,
    isCorrect,
    pointsAwarded,
    playerScore,
    opponentScore,
    rounds,
    loading,
    error,
    gameOver,
    initGame,
    submitAnswer,
  } = useGameStore();

  const roundsEmpty = rounds.length === 0;

  // The track name + album art are spoilers: only reveal them after the
  // player has committed an answer (or the round resolves on timeout).
  const revealTrack =
    roundState === 'answered' || roundState === 'result';

  const previewUrl = currentRound?.track?.preview_url ?? null;
  const clipStartMs = currentRound?.track?.clip_start_ms ?? 0;
  const { playClip, stopClip } = useClipPlayback(previewUrl, clipStartMs);

  const [elapsedDisplay, setElapsedDisplay] = useState('0:00');
  const [remainingDisplay, setRemainingDisplay] = useState('-0:10');
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Score animation
  const scoreScale = useSharedValue(1);
  const scoreAnimStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scoreScale.value }],
  }));

  // Initialize the match from the active room.
  useEffect(() => {
    if (!roomId) {
      router.replace('/');
      return;
    }
    initGame(roomId, isHost);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomId]);

  // Navigate to results when the match completes.
  useEffect(() => {
    if (gameOver) {
      router.replace('/results');
    }
  }, [gameOver]);

  // Play the 3-second clip as soon as the round starts playing.
  useEffect(() => {
    if (roundState === 'playing') {
      playClip();
    } else {
      stopClip();
    }
  }, [roundState, playClip, stopClip]);

  // Elapsed / remaining time display during play.
  useEffect(() => {
    if (roundState === 'playing') {
      let elapsed = 0;
      timerRef.current = setInterval(() => {
        elapsed += 100;
        const secs = Math.floor(elapsed / 1000);
        const remainSecs = Math.max(0, Math.floor((ROUND_DURATION_MS - elapsed) / 1000));
        setElapsedDisplay(`0:${secs.toString().padStart(2, '0')}`);
        setRemainingDisplay(`-0:${remainSecs.toString().padStart(2, '0')}`);
      }, 100);
    } else {
      if (timerRef.current) clearInterval(timerRef.current);
      setElapsedDisplay('0:00');
      setRemainingDisplay('-0:10');
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [roundState]);

  const handleAnswer = useCallback(
    (answer: string) => {
      if (roundState !== 'playing') return;
      submitAnswer(answer);
      scoreScale.value = withSequence(
        withSpring(1.3, { damping: 8 }),
        withSpring(1, { damping: 12 })
      );
    },
    [roundState, submitAnswer, scoreScale]
  );

  const handleTimeout = useCallback(() => {
    if (roundState !== 'playing') return;
    submitAnswer('');
  }, [roundState, submitAnswer]);

  const getButtonState = (option: string): AnswerState => {
    if (roundState === 'playing' || roundState === 'countdown') return 'default';

    if (roundState === 'answered' || roundState === 'result') {
      if (!currentRound) return 'default';
      if (option === currentRound.correctAnswer) return 'correct';
      if (option === selectedAnswer && !isCorrect) return 'incorrect';
      return 'dimmed';
    }

    return 'default';
  };

  if (loading || !currentRound) {
    return (
      <View style={[styles.screen, { paddingTop: insets.top }]}>
        {error ? (
          <View style={styles.loadingBlock}>
            <Text style={styles.errorText}>{error}</Text>
            <Pressable style={styles.errorButton} onPress={() => router.replace('/')}>
              <Text style={styles.errorButtonText}>Back to Home</Text>
            </Pressable>
          </View>
        ) : (
          <View style={styles.loadingBlock}>
            <ActivityIndicator size="large" color={Colors.primary} />
            <Text style={styles.loadingText}>
              {loading
                ? 'Loading...'
                : isHost
                  ? 'Waiting for opponent to join...'
                  : 'Waiting for the host to start the match...'}
            </Text>
          </View>
        )}
      </View>
    );
  }

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      {/* Countdown Overlay */}
      {roundState === 'countdown' && (
        <View style={styles.countdownOverlay}>
          <Animated.View
            key={countdownValue}
            entering={ZoomIn.duration(400)}
            exiting={FadeOut.duration(200)}
          >
            <Text style={styles.countdownNumber}>{countdownValue}</Text>
          </Animated.View>
          <Text style={styles.countdownLabel}>Get Ready</Text>
        </View>
      )}

      {/* Header */}
      <Animated.View entering={FadeIn.delay(200)} style={styles.header}>
        <View style={styles.headerLeft}>
          <Pressable onPress={() => router.back()} style={styles.backButton}>
            <Ionicons name="close" size={24} color={Colors.primary} />
          </Pressable>
          <Text style={styles.roundCounter}>
            {currentRoundIndex}/{totalRounds}
          </Text>
        </View>
        <Animated.View style={[styles.scoreContainer, scoreAnimStyle]}>
          <View style={styles.scoreBlock}>
            <Text style={styles.scoreLabel}>You</Text>
            <Text style={styles.scoreValue}>{playerScore}</Text>
          </View>
          <View style={styles.scoreDivider} />
          <View style={styles.scoreBlock}>
            <Text style={styles.scoreLabel}>Opponent</Text>
            <Text style={styles.scoreValueOpponent}>{opponentScore}</Text>
          </View>
        </Animated.View>
      </Animated.View>

      {/* Main Content */}
      <View style={styles.content}>
        <View style={styles.cardContainer}>
          {/* Artist Card */}
          <Animated.View entering={FadeInDown.delay(300).duration(500)}>
            <GlassCard borderRadius={24} padding={24}>
              {/* Album Art */}
              <View style={styles.albumArtContainer}>
                {revealTrack && currentRound.track?.album_art_url ? (
                  <Image
                    source={{ uri: currentRound.track.album_art_url }}
                    style={styles.albumArt}
                  />
                ) : (
                  <View style={styles.albumArtPlaceholder}>
                    <MaterialCommunityIcons
                      name="music-note"
                      size={48}
                      color={Colors.textSubtle}
                    />
                    <Text style={styles.albumArtHint}>
                      {revealTrack ? 'Guess the track' : 'Listen to the clip'}
                    </Text>
                  </View>
                )}
              </View>

              {/* Artist Info + Progress */}
              <View style={styles.trackInfo}>
                <View style={styles.trackInfoRow}>
                  <View style={styles.trackNameWrap}>
                    <Text style={styles.artistNameText} numberOfLines={1}>
                      {revealTrack
                        ? (currentRound.track?.track_name ?? 'Playing')
                        : 'Guess the track'}
                    </Text>
                    <Text style={styles.artistSubText} numberOfLines={1}>
                      {revealTrack ? 'Correct answer' : 'Tap to hear a clip'}
                    </Text>
                  </View>
                  <MaterialCommunityIcons
                    name={roundState === 'playing' ? 'volume-high' : 'music-note'}
                    size={20}
                    color={Colors.textSubtle}
                  />
                </View>

                {/* Progress Bar */}
                <View style={styles.progressSection}>
                  <ProgressBar
                    duration={ROUND_DURATION_MS}
                    isActive={roundState === 'playing'}
                    onComplete={handleTimeout}
                    height={4}
                  />
                  <View style={styles.timeLabels}>
                    <Text style={styles.timeText}>{elapsedDisplay}</Text>
                    <Text style={styles.timeText}>{remainingDisplay}</Text>
                  </View>
                </View>
              </View>
            </GlassCard>
          </Animated.View>

          {/* Answer Grid — 2x2 */}
          <Animated.View
            entering={FadeInDown.delay(450).duration(500)}
            style={styles.answerGrid}
          >
            <View style={styles.answerRow}>
              <AnswerButton
                label={currentRound.options[0]}
                state={getButtonState(currentRound.options[0])}
                onPress={() => handleAnswer(currentRound.options[0])}
                disabled={roundState !== 'playing'}
              />
              <AnswerButton
                label={currentRound.options[1]}
                state={getButtonState(currentRound.options[1])}
                onPress={() => handleAnswer(currentRound.options[1])}
                disabled={roundState !== 'playing'}
              />
            </View>
            <View style={styles.answerRow}>
              <AnswerButton
                label={currentRound.options[2]}
                state={getButtonState(currentRound.options[2])}
                onPress={() => handleAnswer(currentRound.options[2])}
                disabled={roundState !== 'playing'}
              />
              <AnswerButton
                label={currentRound.options[3]}
                state={getButtonState(currentRound.options[3])}
                onPress={() => handleAnswer(currentRound.options[3])}
                disabled={roundState !== 'playing'}
              />
            </View>
          </Animated.View>

          {/* Result Feedback */}
          {roundState === 'result' && (
            <Animated.View
              entering={FadeInDown.duration(300)}
              style={styles.resultFeedback}
            >
              <View
                style={[
                  styles.resultBadge,
                  {
                    backgroundColor: isCorrect
                      ? Colors.correctBg
                      : Colors.incorrectBg,
                    borderColor: isCorrect
                      ? Colors.correct
                      : Colors.incorrect,
                  },
                ]}
              >
                <MaterialCommunityIcons
                  name={isCorrect ? 'check-circle' : 'close-circle'}
                  size={20}
                  color={isCorrect ? Colors.correct : Colors.incorrect}
                />
                <Text
                  style={[
                    styles.resultText,
                    { color: isCorrect ? Colors.correct : Colors.incorrect },
                  ]}
                >
                  {isCorrect
                    ? `+${pointsAwarded} pts`
                    : `Correct: ${currentRound.correctAnswer}`}
                </Text>
              </View>
            </Animated.View>
          )}

          {/* Waiting for opponent */}
          {roundState === 'answered' && (
            <Animated.View
              entering={FadeInDown.duration(300)}
              style={styles.resultFeedback}
            >
              <View style={styles.waitingBadge}>
                <ActivityIndicator size="small" color={Colors.textSubtle} />
                <Text style={styles.waitingText}>Waiting for opponent...</Text>
              </View>
            </Animated.View>
          )}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  loadingBlock: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.md,
    paddingHorizontal: Spacing.containerPadding,
  },
  loadingText: {
    color: Colors.textSubtle,
    fontFamily: 'Inter',
    fontSize: 15,
    textAlign: 'center',
  },
  errorText: {
    color: Colors.incorrect,
    fontFamily: 'Inter-Bold',
    fontSize: 16,
    textAlign: 'center',
  },
  errorButton: {
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderRadius: BorderRadius.full,
    paddingHorizontal: 24,
    paddingVertical: 12,
  },
  errorButtonText: {
    fontFamily: 'Inter-Bold',
    fontSize: 14,
    color: Colors.primary,
  },

  // Countdown
  countdownOverlay: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 100,
    backgroundColor: 'rgba(10, 10, 10, 0.9)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  countdownNumber: {
    fontFamily: 'Inter-Bold',
    fontSize: 96,
    color: Colors.primary,
    textAlign: 'center',
  },
  countdownLabel: {
    fontFamily: 'Inter',
    fontSize: 18,
    color: Colors.textSubtle,
    marginTop: 8,
  },

  // Header
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: Spacing.containerPadding,
    paddingVertical: Spacing.md,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
  },
  backButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.08)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  roundCounter: {
    fontFamily: 'Inter-Bold',
    fontSize: 24,
    color: Colors.primary,
    letterSpacing: -0.5,
  },
  scoreContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderRadius: BorderRadius.lg,
    paddingHorizontal: 16,
    paddingVertical: 8,
    gap: 12,
  },
  scoreBlock: {
    alignItems: 'center',
  },
  scoreLabel: {
    fontFamily: 'Inter',
    fontSize: 10,
    color: Colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  scoreValue: {
    fontFamily: 'Inter-Bold',
    fontSize: 18,
    color: Colors.primary,
  },
  scoreValueOpponent: {
    fontFamily: 'Inter-Bold',
    fontSize: 18,
    color: Colors.textSubtle,
  },
  scoreDivider: {
    width: 1,
    height: 28,
    backgroundColor: 'rgba(255,255,255,0.1)',
  },

  // Content
  content: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: Spacing.containerPadding,
  },
  cardContainer: {
    gap: Spacing.md,
  },

  // Album Art
  albumArtContainer: {
    width: '100%',
    aspectRatio: 1,
    borderRadius: BorderRadius.md,
    overflow: 'hidden',
    backgroundColor: Colors.surfaceContainerLow,
    marginBottom: Spacing.lg,
  },
  albumArt: {
    width: '100%',
    height: '100%',
    resizeMode: 'cover',
  },
  albumArtPlaceholder: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.surfaceContainerLow,
    gap: Spacing.sm,
  },
  albumArtHint: {
    fontFamily: 'Inter',
    fontSize: 12,
    color: Colors.textSubtle,
    marginTop: Spacing.sm,
  },

  // Track Info
  trackInfo: {
    gap: Spacing.sm,
  },
  trackInfoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  trackNameWrap: {
    flex: 1,
    marginRight: Spacing.sm,
  },
  artistNameText: {
    fontFamily: 'PlayfairDisplay',
    fontSize: 22,
    color: Colors.primary,
  },
  artistSubText: {
    fontFamily: 'Inter',
    fontSize: 12,
    color: Colors.textSubtle,
    marginTop: 2,
  },

  // Progress
  progressSection: {
    gap: 6,
    marginTop: Spacing.md,
  },
  timeLabels: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  timeText: {
    fontFamily: 'Inter',
    fontSize: 10,
    color: Colors.textMuted,
  },

  // Answer Grid
  answerGrid: {
    gap: Spacing.gutter,
  },
  answerRow: {
    flexDirection: 'row',
    gap: Spacing.gutter,
  },

  // Result Feedback
  resultFeedback: {
    alignItems: 'center',
  },
  resultBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: BorderRadius.full,
    borderWidth: 1,
  },
  resultText: {
    fontFamily: 'Inter-Bold',
    fontSize: 14,
  },
  waitingBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: BorderRadius.full,
    backgroundColor: 'rgba(255,255,255,0.06)',
  },
  waitingText: {
    fontFamily: 'Inter',
    fontSize: 13,
    color: Colors.textSubtle,
  },
});
