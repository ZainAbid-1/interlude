import React, { useEffect, useRef, useState, useCallback } from 'react';
import {
  View,
  Text,
  Image,
  StyleSheet,
  Dimensions,
  Pressable,
} from 'react-native';
import { router } from 'expo-router';
import { BlurView } from 'expo-blur';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withSpring,
  withDelay,
  withSequence,
  FadeIn,
  FadeInDown,
  FadeOut,
  ZoomIn,
  Easing,
  runOnJS,
} from 'react-native-reanimated';
import { MaterialCommunityIcons, Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { GlassCard } from '../components/GlassCard';
import { AnswerButton } from '../components/AnswerButton';
import { ProgressBar } from '../components/ProgressBar';
import { useGameStore } from '../store/gameStore';
import { Colors, Spacing, BorderRadius, Typography } from '../constants/theme';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const ROUND_DURATION = 10000; // 10 seconds per round

type AnswerState = 'default' | 'selected' | 'correct' | 'incorrect' | 'dimmed';

export default function GameScreen() {
  const insets = useSafeAreaInsets();
  const roundStartTime = useRef<number>(0);
  const [countdownNum, setCountdownNum] = useState(3);
  const [showCountdown, setShowCountdown] = useState(true);
  const [elapsedDisplay, setElapsedDisplay] = useState('0:00');
  const [remainingDisplay, setRemainingDisplay] = useState('-0:10');
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const {
    artistName,
    artistImage,
    currentRoundIndex,
    totalRounds,
    currentRound,
    roundState,
    selectedAnswer,
    isCorrect,
    pointsAwarded,
    playerScore,
    opponentScore,
    startCountdown,
    startPlaying,
    submitAnswer,
    showResult,
    nextRound,
    isGameOver,
    initGame,
  } = useGameStore();

  // Score animation
  const scoreScale = useSharedValue(1);
  const scoreAnimStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scoreScale.value }],
  }));

  // Initialize game and start first round countdown
  useEffect(() => {
    if (!currentRound) {
      initGame();
    }
    startInitialCountdown();
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  const startInitialCountdown = () => {
    setShowCountdown(true);
    setCountdownNum(3);

    let count = 3;
    const interval = setInterval(() => {
      count--;
      if (count > 0) {
        setCountdownNum(count);
      } else {
        clearInterval(interval);
        setShowCountdown(false);
        beginPlaying();
      }
    }, 1000);
  };

  const beginPlaying = () => {
    startPlaying();
    roundStartTime.current = Date.now();

    // Elapsed / remaining time display
    let elapsed = 0;
    timerRef.current = setInterval(() => {
      elapsed += 100;
      const secs = Math.floor(elapsed / 1000);
      const remainSecs = Math.max(0, 10 - secs);
      setElapsedDisplay(`0:${secs.toString().padStart(2, '0')}`);
      setRemainingDisplay(`-0:${remainSecs.toString().padStart(2, '0')}`);
    }, 100);
  };

  const handleAnswer = useCallback(
    (answer: string) => {
      if (roundState !== 'playing') return;

      if (timerRef.current) clearInterval(timerRef.current);

      const responseMs = Date.now() - roundStartTime.current;
      submitAnswer(answer, responseMs);

      // Show result after brief delay
      setTimeout(() => {
        showResult();
        scoreScale.value = withSequence(
          withSpring(1.3, { damping: 8 }),
          withSpring(1, { damping: 12 })
        );

        // Auto-advance after showing result
        setTimeout(() => {
          if (isGameOver()) {
            router.replace('/results');
          } else {
            nextRound();
            startInitialCountdown();
          }
        }, 2000);
      }, 500);
    },
    [roundState]
  );

  const handleTimeout = useCallback(() => {
    if (roundState !== 'playing') return;
    if (timerRef.current) clearInterval(timerRef.current);

    // Auto-submit empty answer on timeout
    submitAnswer('', 10000);
    setTimeout(() => {
      showResult();
      setTimeout(() => {
        if (isGameOver()) {
          router.replace('/results');
        } else {
          nextRound();
          startInitialCountdown();
        }
      }, 2000);
    }, 500);
  }, [roundState]);

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

  if (!currentRound) {
    return (
      <View style={[styles.screen, { paddingTop: insets.top }]}>
        <Text style={styles.loadingText}>Loading...</Text>
      </View>
    );
  }

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      {/* Countdown Overlay */}
      {showCountdown && (
        <View style={styles.countdownOverlay}>
          <Animated.View
            key={countdownNum}
            entering={ZoomIn.duration(400)}
            exiting={FadeOut.duration(200)}
          >
            <Text style={styles.countdownNumber}>{countdownNum}</Text>
          </Animated.View>
          <Text style={styles.countdownLabel}>Get Ready</Text>
        </View>
      )}

      {/* Header */}
      <Animated.View
        entering={FadeIn.delay(200)}
        style={styles.header}
      >
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
            <Text style={styles.scoreLabel}>Alex</Text>
            <Text style={styles.scoreValueOpponent}>{opponentScore}</Text>
          </View>
        </Animated.View>
      </Animated.View>

      {/* Main Content */}
      <View style={styles.content}>
        <View style={styles.cardContainer}>
          {/* Artist Card — matches Stitch reference */}
          <Animated.View entering={FadeInDown.delay(300).duration(500)}>
            <GlassCard borderRadius={24} padding={24}>
              {/* Album Art */}
              <View style={styles.albumArtContainer}>
                <Image
                  source={{ uri: artistImage || currentRound.track.albumArt }}
                  style={styles.albumArt}
                />
              </View>

              {/* Artist Info + Progress */}
              <View style={styles.trackInfo}>
                <View style={styles.trackInfoRow}>
                  <View>
                    <Text style={styles.artistNameText}>{artistName}</Text>
                  </View>
                  <MaterialCommunityIcons
                    name="cast"
                    size={20}
                    color={Colors.textSubtle}
                  />
                </View>

                {/* Progress Bar */}
                <View style={styles.progressSection}>
                  <ProgressBar
                    duration={ROUND_DURATION}
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
                    {
                      color: isCorrect ? Colors.correct : Colors.incorrect,
                    },
                  ]}
                >
                  {isCorrect
                    ? `+${pointsAwarded} pts`
                    : `Correct: ${currentRound.correctAnswer}`}
                </Text>
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
  loadingText: {
    color: Colors.textSubtle,
    fontFamily: 'Inter',
    fontSize: 16,
    textAlign: 'center',
    marginTop: 100,
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

  // Track Info
  trackInfo: {
    gap: Spacing.sm,
  },
  trackInfoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
  },
  artistNameText: {
    fontFamily: 'PlayfairDisplay',
    fontSize: 24,
    color: Colors.primary,
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
});
