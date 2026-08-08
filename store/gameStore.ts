import { create } from 'zustand';
import { MOCK_GAME_SESSION, type MockRound } from '../data/mockGame';

type RoundState = 'idle' | 'countdown' | 'playing' | 'answered' | 'result';

interface GameState {
  // Match info
  artistName: string;
  artistImage: string;
  totalRounds: number;

  // Current round
  currentRoundIndex: number;
  currentRound: MockRound | null;
  roundState: RoundState;
  countdownValue: number;

  // Player answers
  selectedAnswer: string | null;
  isCorrect: boolean | null;
  responseTimeMs: number;
  pointsAwarded: number;

  // Scores
  playerScore: number;
  opponentScore: number;
  playerCorrectCount: number;
  opponentCorrectCount: number;

  // Round history
  roundResults: Array<{
    roundIndex: number;
    playerAnswer: string | null;
    playerCorrect: boolean;
    playerPoints: number;
    opponentCorrect: boolean;
    opponentPoints: number;
  }>;

  // Actions
  initGame: () => void;
  startCountdown: () => void;
  startPlaying: () => void;
  submitAnswer: (answer: string, responseMs: number) => void;
  showResult: () => void;
  nextRound: () => void;
  resetGame: () => void;
  isGameOver: () => boolean;
}

function calculatePoints(isCorrect: boolean, responseMs: number): number {
  if (!isCorrect) return 0;
  const basePoints = 100;
  const roundTimeLimit = 10000; // 10 seconds
  const speedBonus = Math.max(
    0,
    100 - Math.floor((responseMs / roundTimeLimit) * 100)
  );
  return basePoints + speedBonus;
}

export const useGameStore = create<GameState>((set, get) => ({
  artistName: '',
  artistImage: '',
  totalRounds: 10,
  currentRoundIndex: 0,
  currentRound: null,
  roundState: 'idle',
  countdownValue: 3,
  selectedAnswer: null,
  isCorrect: null,
  responseTimeMs: 0,
  pointsAwarded: 0,
  playerScore: 0,
  opponentScore: 0,
  playerCorrectCount: 0,
  opponentCorrectCount: 0,
  roundResults: [],

  initGame: () => {
    const session = MOCK_GAME_SESSION;
    set({
      artistName: session.artistName,
      artistImage: session.artistImage,
      totalRounds: session.rounds.length,
      currentRoundIndex: 1,
      currentRound: session.rounds[0],
      roundState: 'idle',
      playerScore: 0,
      opponentScore: 0,
      playerCorrectCount: 0,
      opponentCorrectCount: 0,
      roundResults: [],
      selectedAnswer: null,
      isCorrect: null,
      responseTimeMs: 0,
      pointsAwarded: 0,
    });
  },

  startCountdown: () => set({ roundState: 'countdown', countdownValue: 3 }),

  startPlaying: () =>
    set({
      roundState: 'playing',
      selectedAnswer: null,
      isCorrect: null,
      pointsAwarded: 0,
    }),

  submitAnswer: (answer: string, responseMs: number) => {
    const { currentRound } = get();
    if (!currentRound) return;

    const correct = answer === currentRound.correctAnswer;
    const points = calculatePoints(correct, responseMs);

    set({
      selectedAnswer: answer,
      isCorrect: correct,
      responseTimeMs: responseMs,
      pointsAwarded: points,
      roundState: 'answered',
    });
  },

  showResult: () => {
    const state = get();
    const { currentRound, selectedAnswer, isCorrect, pointsAwarded } = state;
    if (!currentRound) return;

    // Simulate opponent answer
    const opponentCorrect = Math.random() > 0.4;
    const opponentResponseMs = 1500 + Math.random() * 5000;
    const opponentPoints = calculatePoints(opponentCorrect, opponentResponseMs);

    const roundResult = {
      roundIndex: state.currentRoundIndex,
      playerAnswer: selectedAnswer,
      playerCorrect: isCorrect ?? false,
      playerPoints: pointsAwarded,
      opponentCorrect,
      opponentPoints,
    };

    set({
      roundState: 'result',
      playerScore: state.playerScore + pointsAwarded,
      opponentScore: state.opponentScore + opponentPoints,
      playerCorrectCount:
        state.playerCorrectCount + (isCorrect ? 1 : 0),
      opponentCorrectCount:
        state.opponentCorrectCount + (opponentCorrect ? 1 : 0),
      roundResults: [...state.roundResults, roundResult],
    });
  },

  nextRound: () => {
    const { currentRoundIndex, totalRounds } = get();
    const nextIndex = currentRoundIndex + 1;

    if (nextIndex > totalRounds) return;

    const session = MOCK_GAME_SESSION;
    set({
      currentRoundIndex: nextIndex,
      currentRound: session.rounds[nextIndex - 1],
      roundState: 'idle',
      selectedAnswer: null,
      isCorrect: null,
      responseTimeMs: 0,
      pointsAwarded: 0,
    });
  },

  resetGame: () => {
    set({
      artistName: '',
      artistImage: '',
      totalRounds: 10,
      currentRoundIndex: 0,
      currentRound: null,
      roundState: 'idle',
      countdownValue: 3,
      selectedAnswer: null,
      isCorrect: null,
      responseTimeMs: 0,
      pointsAwarded: 0,
      playerScore: 0,
      opponentScore: 0,
      playerCorrectCount: 0,
      opponentCorrectCount: 0,
      roundResults: [],
    });
  },

  isGameOver: () => {
    const { currentRoundIndex, totalRounds, roundState } = get();
    return currentRoundIndex >= totalRounds && roundState === 'result';
  },
}));
