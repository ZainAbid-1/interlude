import React, { useEffect, useRef, useState, useCallback } from 'react';
import {
  View,
  Text,
  Image,
  StyleSheet,
  Dimensions,
  Pressable,
  ActivityIndicator,
  ScrollView,
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
import { useGameStore, ROUND_DURATION_MS, getRoundStartAt } from '../store/gameStore';
import { useRoomStore } from '../store/roomStore';
import { useClipPlayback, CLIP_DURATION_MS } from '../hooks/useClipPlayback';
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

  // Track name + album art are spoilers: reveal only after the player has
  // committed an answer (or the round resolves on timeout).
  const revealTrack =
    roundState === 'answered' || roundState === 'result';

  const previewUrl = currentRound?.track?.preview_url ?? null;
  const coverUrl = currentRound?.track?.album_art_url ?? null;
  // The cover fades in only once it has actually loaded; reset per round.
  const [coverLoaded, setCoverLoaded] = useState(false);
  useEffect(() => {
    setCoverLoaded(false);
  }, [coverUrl]);
  const clipStartMs = currentRound?.track?.clip_start_ms ?? 0;
  const { playClip, stopClip, clipStarted, getClipSkipMs } = useClipPlayback(
    previewUrl,
    clipStartMs
  );

  // `clipStarted` is the single source of truth for "audio is actually audible".
  // Everything that reflects the clip (progress bar + elapsed label) is anchored
  // to the moment the player reported playing, so the UI never runs ahead of
  // the music while a clip is still buffering.
  const audioStartRef = useRef<number | null>(null);

  const [elapsedDisplay, setElapsedDisplay] = useState('0:00');
  const [remainingDisplay, setRemainingDisplay] = useState(
    () => `-0:${((ROUND_DURATION_MS - CLIP_DURATION_MS) / 1000).toString().padStart(2, '0')}`
  );
  const [elapsedMs, setElapsedMs] = useState(0);
  const [guessTimeLeft, setGuessTimeLeft] = useState(
    (ROUND_DURATION_MS - CLIP_DURATION_MS) / 1000
  );
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Record the wall-clock instant the clip genuinely starts, once per round.
  useEffect(() => {
    if (clipStarted && audioStartRef.current === null) {
      // If playback skipped ahead to stay in sync, start the bar part-way.
      audioStartRef.current = Date.now() - getClipSkipMs();
    }
  }, [clipStarted, getClipSkipMs]);

  // The loader only spans the 3s clip; the trailing 5s is a separate timer.
  const isGuessPhase =
    roundState === 'playing' && elapsedMs >= CLIP_DURATION_MS;

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
      // Leaving the screen any way (✕, Android back) mid-match tells the
      // opponent immediately; after game over the results screen takes over.
      if (!useGameStore.getState().gameOver) useGameStore.getState().leaveMatch();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomId]);

  /** Leave mid-match: tell the opponent, drop the room, go home. */
  const exitMatch = useCallback(() => {
    useGameStore.getState().leaveMatch();
    // A match that already started can't be rejoined; the lobby keeps its
    // room so the host can still share the code.
    if (useGameStore.getState().currentRound || currentRound) {
      useRoomStore.getState().resetRoom();
    }
    router.replace('/');
  }, [currentRound]);

  // Navigate to results when the match completes.
  useEffect(() => {
    if (gameOver) {
      router.replace('/results');
    }
  }, [gameOver]);

  // Play the 3-second clip as soon as the round starts playing.
  useEffect(() => {
    if (roundState === 'playing') {
      // Aim at the shared, clock-synced start so both phones hear the same slice.
      playClip(getRoundStartAt());
    } else {
      stopClip();
    }
  }, [roundState, playClip, stopClip]);

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

  // Elapsed / remaining time display during play. The clip progress (bar +
  // elapsed label) is anchored to when the audio actually started so it stays
  // in lockstep with the audible music; the trailing guess countdown stays on
  // the round's wall clock so round timing remains fair for both players.
  useEffect(() => {
    if (roundState === 'playing') {
      const roundAnchor = Date.now();
      audioStartRef.current = null;
      timerRef.current = setInterval(() => {
        // Clip progress — anchored to the real audio start.
        let elapsed = 0;
        if (audioStartRef.current != null) {
          elapsed = Date.now() - audioStartRef.current;
        }
        setElapsedMs(elapsed);
        const clipSecs = Math.floor(Math.min(elapsed, CLIP_DURATION_MS) / 1000);
        setElapsedDisplay(`0:${clipSecs.toString().padStart(2, '0')}`);

        // Guess countdown — anchored to the wall clock so it never stretches
        // when a client buffers slowly.
        const wallElapsed = Date.now() - roundAnchor;
        const guessSecs = Math.max(
          0,
          Math.ceil((ROUND_DURATION_MS - wallElapsed) / 1000)
        );
        setRemainingDisplay(`-0:${guessSecs.toString().padStart(2, '0')}`);
        setGuessTimeLeft(guessSecs);
        if (wallElapsed >= ROUND_DURATION_MS) {
          if (timerRef.current) clearInterval(timerRef.current);
          handleTimeout();
        }
      }, 100);
    } else {
      if (timerRef.current) clearInterval(timerRef.current);
      audioStartRef.current = null;
      setElapsedMs(0);
      setElapsedDisplay('0:00');
      const guessSecs = (ROUND_DURATION_MS - CLIP_DURATION_MS) / 1000;
      setRemainingDisplay(`-0:${guessSecs.toString().padStart(2, '0')}`);
      setGuessTimeLeft(guessSecs);
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [roundState, handleTimeout]);

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
        <ConnectionOverlay onExit={exitMatch} />
        {error ? (
          <View style={styles.loadingBlock}>
            <Text style={styles.errorText}>{error}</Text>
            <Pressable style={styles.errorButton} onPress={exitMatch}>
              <Text style={styles.errorButtonText}>Back to Home</Text>
            </Pressable>
          </View>
        ) : (
          <Animated.View
            entering={FadeIn.duration(500)}
            style={styles.loadingBlock}
          >
            <View style={styles.loadingPulse}>
              <MaterialCommunityIcons
                name={isHost ? 'account-plus-outline' : 'headphones'}
                size={40}
                color={Colors.primary}
              />
            </View>
            <Text style={styles.loadingTitle}>
              {isHost
                ? 'Waiting for your opponent'
                : 'Waiting for the host'}
            </Text>
            <Text style={styles.loadingText}>
              {loading
                ? 'Preparing the match...'
                : isHost
                  ? 'Share your room code to get playing'
                  : 'The host will start the match soon...'}
            </Text>
            <ActivityIndicator size="small" color={Colors.primary} />
          </Animated.View>
        )}
      </View>
    );
  }

  return (
    <Animated.View
      entering={FadeIn.duration(350)}
      style={[styles.screen, { paddingTop: insets.top, paddingBottom: insets.bottom }]}
    >
      <ConnectionOverlay onExit={exitMatch} />

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
          <Pressable onPress={exitMatch} style={styles.backButton}>
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
      <View
        style={[styles.content, styles.scrollContent]}
      >
        <View style={styles.cardContainer}>
          {/* Artist Card */}
          <Animated.View entering={FadeInDown.delay(300).duration(500)} style={{ flex: 1 }}>
            <GlassCard borderRadius={24} padding={24} style={{ flex: 1 }}>
              {/* Album Art + Guess Timer overlay */}
              <View style={styles.albumArtContainer}>
                {/* Placeholder stays underneath so the box is never blank
                    while the cover is still loading. */}
                <View style={styles.albumArtPlaceholder}>
                  <MaterialCommunityIcons
                    name="music-note"
                    size={48}
                    color={Colors.textSubtle}
                  />
                  <Text style={styles.albumArtHint}>
                    {!revealTrack
                      ? 'Listen to the clip'
                      : coverUrl
                        ? 'Loading cover…'
                        : 'Guess the track'}
                  </Text>
                </View>
                {revealTrack && coverUrl ? (
                  <Image
                    source={{ uri: coverUrl }}
                    style={[styles.albumArt, styles.albumArtOverlay, { opacity: coverLoaded ? 1 : 0 }]}
                    onLoad={() => setCoverLoaded(true)}
                  />
                ) : null}

                {/* Guess Timer — separate 5s countdown once the clip ends */}
                {isGuessPhase && (
                  <Animated.View
                    entering={FadeIn.duration(200)}
                    style={styles.guessTimerOverlay}
                  >
                    <Text key={guessTimeLeft} style={styles.guessTimerValue}>
                      {guessTimeLeft < 10
                        ? `0${guessTimeLeft}`
                        : guessTimeLeft}
                    </Text>
                    <Text style={styles.guessTimerLabel}>s</Text>
                  </Animated.View>
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
                    duration={CLIP_DURATION_MS}
                    isActive={roundState === 'playing' && clipStarted}
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
    </Animated.View>
  );
}

/**
 * Blocks the game with a clear message whenever the match can't safely go
 * on: the opponent dropped (paused), left (over), never showed up (guest in
 * a dead room), or this phone lost its own connection.
 */
function ConnectionOverlay({ onExit }: { onExit: () => void }) {
  const opponentStatus = useGameStore((s) => s.opponentStatus);
  const selfConnection = useGameStore((s) => s.selfConnection);
  const isHost = useGameStore((s) => s.isHost);
  const gameOver = useGameStore((s) => s.gameOver);
  if (gameOver) return null;

  const other = isHost ? 'Your opponent' : 'The host';
  let icon: React.ComponentProps<typeof MaterialCommunityIcons>['name'];
  let title: string;
  let body: string;
  let waiting = false;
  let action: string;

  if (opponentStatus === 'left') {
    icon = 'account-off-outline';
    title = `${other} left the match`;
    body = "This match can't continue. No scores were recorded.";
    action = 'Back to Home';
  } else if (opponentStatus === 'ended') {
    icon = 'timer-off-outline';
    title = 'The match ended while you were away';
    body = `${other} couldn't reach you for too long, so the match was stopped.`;
    action = 'Back to Home';
  } else if (selfConnection === 'reconnecting') {
    icon = 'wifi-off';
    title = "You're offline";
    body = "Reconnecting… The match will pick up when you're back.";
    waiting = true;
    action = 'Leave match';
  } else if (opponentStatus === 'reconnecting') {
    icon = 'access-point-network-off';
    title = `${other} lost connection`;
    body = "The game is paused until they're back.";
    waiting = true;
    action = 'Leave match';
  } else if (opponentStatus === 'absent') {
    // Not final: clears as soon as the host opens the game screen.
    icon = 'door-closed';
    title = "The host hasn't opened the room yet";
    body = "They may still be on the home screen, or they've left. Keep waiting or leave.";
    waiting = true;
    action = 'Leave';
  } else {
    return null;
  }

  return (
    <Animated.View
      entering={FadeIn.duration(200)}
      exiting={FadeOut.duration(200)}
      style={styles.connectionOverlay}
    >
      <View style={styles.connectionCard}>
        <View style={styles.loadingPulse}>
          <MaterialCommunityIcons name={icon} size={36} color={Colors.primary} />
        </View>
        <Text style={styles.loadingTitle}>{title}</Text>
        <Text style={styles.loadingText}>{body}</Text>
        {waiting ? <ActivityIndicator size="small" color={Colors.primary} /> : null}
        <Pressable style={styles.errorButton} onPress={onExit}>
          <Text style={styles.errorButtonText}>{action}</Text>
        </Pressable>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  connectionOverlay: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 200,
    elevation: 200,
    backgroundColor: 'rgba(0,0,0,0.82)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.containerPadding,
  },
  connectionCard: {
    width: '100%',
    maxWidth: 360,
    alignItems: 'center',
    gap: Spacing.md,
    paddingVertical: Spacing.xl,
    paddingHorizontal: Spacing.lg,
    borderRadius: BorderRadius.lg,
    backgroundColor: Colors.surfaceContainerLow,
  },
  loadingBlock: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.md,
    paddingHorizontal: Spacing.containerPadding,
  },
  loadingPulse: {
    width: 84,
    height: 84,
    borderRadius: 42,
    backgroundColor: 'rgba(255,255,255,0.07)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  loadingTitle: {
    color: Colors.primary,
    fontFamily: 'Inter-Bold',
    fontSize: 18,
    textAlign: 'center',
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
  },
  scrollContent: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingHorizontal: Spacing.containerPadding,
    paddingBottom: Spacing.lg,
  },
  cardContainer: {
    gap: Spacing.md,
    flex: 1,
  },

  // Album Art
  albumArtContainer: {
    width: '100%',
    flex: 1,
    minHeight: 120,
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
  albumArtOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
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

  // Guess Timer (overlaid on the album art so the answer grid never shifts)
  guessTimerOverlay: {
    position: 'absolute',
    top: Spacing.md,
    right: Spacing.md,
    flexDirection: 'row',
    alignItems: 'baseline',
    backgroundColor: 'rgba(10, 10, 10, 0.82)',
    borderRadius: BorderRadius.lg,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.28)',
    paddingHorizontal: 14,
    paddingVertical: 8,
    gap: 4,
  },
  guessTimerValue: {
    fontFamily: 'Inter-Bold',
    fontSize: 26,
    color: Colors.primary,
    minWidth: 32,
    textAlign: 'center',
  },
  guessTimerLabel: {
    fontFamily: 'Inter',
    fontSize: 12,
    color: Colors.textSubtle,
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
