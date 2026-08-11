import { create } from 'zustand';
import { supabase } from '../lib/supabase';
import type { RealtimeChannel } from '@supabase/supabase-js';
import type { RoomPoolTrack } from '../services/rooms';
import { loadPool } from '../services/rooms';
import {
  fetchRoundsForRoom,
  generateRoundsForRoom,
  submitRoundAnswer,
  fetchRoundAnswers,
} from '../services/rounds';

type RoundState = 'idle' | 'countdown' | 'playing' | 'answered' | 'result';

export const ROUND_DURATION_MS = 8000; // 8 seconds per round (3s clip + 5s guess)
export const COUNTDOWN_MS = 3000; // 3-second countdown before clip plays

interface GameRound {
  id: string;
  roundIndex: number;
  track: RoomPoolTrack | null;
  options: string[];
  correctAnswer: string;
}

interface RoundResult {
  roundIndex: number;
  playerAnswer: string | null;
  playerCorrect: boolean;
  playerPoints: number;
  opponentCorrect: boolean;
  opponentPoints: number;
}

interface GameState {
  // Match info
  roomId: string;
  playerId: string;
  opponentId: string | null;
  isHost: boolean;
  artistName: string;
  artistImage: string;
  totalRounds: number;

  // Rounds
  rounds: GameRound[];
  currentRoundIndex: number;
  currentRound: GameRound | null;
  roundState: RoundState;
  countdownValue: number;

  // Player answer (this round)
  selectedAnswer: string | null;
  isCorrect: boolean | null;
  responseTimeMs: number;
  pointsAwarded: number;

  // Opponent answer (this round, transient)
  opponentRoundCorrect: boolean;
  opponentRoundPoints: number;

  // Answered flags (both must answer to resolve)
  myAnswered: boolean;
  opponentAnswered: boolean;

  // Scores
  playerScore: number;
  opponentScore: number;
  playerCorrectCount: number;
  opponentCorrectCount: number;

  // Round history
  roundResults: RoundResult[];
  gameOver: boolean;
  loading: boolean;
  error: string | null;

  // Actions
  prepareMatch: (roomId: string) => Promise<{ ok: boolean; error?: string }>;
  initGame: (roomId: string, isHost: boolean) => Promise<{ ok: boolean; error?: string }>;
  submitAnswer: (answer: string) => Promise<void>;
  resetGame: () => void;
}

function calculatePoints(isCorrect: boolean, responseMs: number): number {
  if (!isCorrect) return 0;
  const basePoints = 100;
  const speedBonus = Math.max(
    0,
    100 - Math.floor((responseMs / ROUND_DURATION_MS) * 100)
  );
  return basePoints + speedBonus;
}

const roundStartRef = { at: 0 }; // Date.now() when the clip started playing

let timers: ReturnType<typeof setTimeout>[] = [];
function clearTimers() {
  timers.forEach(clearTimeout);
  timers = [];
}
function later(fn: () => void, ms: number) {
  timers.push(setTimeout(fn, ms));
}

// Polling fallbacks. Supabase Realtime websockets can silently drop events,
// so we re-poll room state and round answers so a match never hard-stalls
// on "waiting for opponent" or "waiting for the host".
const POLL_START_MS = 2500;
const POLL_ANSWER_MS = 1500;
let startPollTimer: ReturnType<typeof setInterval> | null = null;
let answerPollTimer: ReturnType<typeof setInterval> | null = null;

function clearPolling() {
  if (startPollTimer) clearInterval(startPollTimer);
  if (answerPollTimer) clearInterval(answerPollTimer);
  startPollTimer = null;
  answerPollTimer = null;
}

function clearStartPoll() {
  if (startPollTimer) clearInterval(startPollTimer);
  startPollTimer = null;
}

function clearAnswerPoll() {
  if (answerPollTimer) clearInterval(answerPollTimer);
  answerPollTimer = null;
}

let roomChannel: RealtimeChannel | null = null;
let answersChannel: RealtimeChannel | null = null;

/** Coalesces concurrent `prepareMatch` calls (Realtime + polling) so the host
 *  only ever generates rounds / activates the room once. */
let activationPromise: Promise<{ ok: boolean; error?: string }> | null = null;

export const useGameStore = create<GameState>((set, get) => ({
  roomId: '',
  playerId: '',
  opponentId: null,
  isHost: false,
  artistName: '',
  artistImage: '',
  totalRounds: 10,
  rounds: [],
  currentRoundIndex: 0,
  currentRound: null,
  roundState: 'idle',
  countdownValue: 3,
  selectedAnswer: null,
  isCorrect: null,
  responseTimeMs: 0,
  pointsAwarded: 0,
  opponentRoundCorrect: false,
  opponentRoundPoints: 0,
  myAnswered: false,
  opponentAnswered: false,
  playerScore: 0,
  opponentScore: 0,
  playerCorrectCount: 0,
  opponentCorrectCount: 0,
  roundResults: [],
  gameOver: false,
  loading: false,
  error: null,

  /** Host-only: generate rounds (if needed) and activate the room. */
  prepareMatch: (roomId) => {
    if (!supabase) {
      return Promise.resolve({ ok: false, error: 'Supabase is not configured' });
    }
    // Realtime + the polling fallback can both fire activation; coalesce them
    // so rounds are generated exactly once.
    if (activationPromise) return activationPromise;

    activationPromise = (async () => {
      const room = await fetchRoom(roomId);
      if (!room) return { ok: false, error: 'Room not found' };

      if (!room.guest_id) {
        return { ok: false, error: 'Waiting for opponent to join...' };
      }

      const pool = await loadPool(room.track_pool_id);
      if ('error' in pool) return { ok: false, error: pool.error };

      const existing = await fetchRoundsForRoom(roomId);
      if (!existing || existing.length === 0) {
        const gen = await generateRoundsForRoom(roomId, pool.tracks);
        if (!gen.ok) return { ok: false, error: gen.error };
      }

      const { error } = await supabase
        .from('rooms')
        .update({
          status: 'active',
          current_round: 1,
          round_started_at: new Date().toISOString(),
        })
        .eq('id', roomId)
        .eq('status', 'waiting'); // only the first activation wins
      if (error) return { ok: false, error: error.message };

      return { ok: true };
    })().finally(() => {
      activationPromise = null;
    });

    return activationPromise;
  },

  /** Loads rounds + pool, subscribes to realtime, starts round 1 when active. */
  initGame: async (roomId, isHost) => {
    if (!supabase) return { ok: false, error: 'Supabase is not configured' };

    clearTimers();
    clearPolling();
    roomChannel?.unsubscribe();
    answersChannel?.unsubscribe();
    roomChannel = null;
    answersChannel = null;

    const playerId = (await supabase.auth.getUser()).data.user?.id ?? '';

    set({
      roomId,
      isHost,
      playerId,
      loading: true,
      error: null,
      gameOver: false,
      rounds: [],
      currentRoundIndex: 0,
      currentRound: null,
      roundState: 'idle',
      selectedAnswer: null,
      isCorrect: null,
      playerScore: 0,
      opponentScore: 0,
      playerCorrectCount: 0,
      opponentCorrectCount: 0,
      roundResults: [],
      myAnswered: false,
      opponentAnswered: false,
    });

    const room = await fetchRoom(roomId);
    if (!room) {
      set({ loading: false, error: 'Room not found' });
      return { ok: false, error: 'Room not found' };
    }

    const pool = await loadPool(room.track_pool_id);
    if ('error' in pool) {
      set({ loading: false, error: pool.error });
      return { ok: false, error: pool.error };
    }

    set({
      loading: false,
      artistName: pool.artist.name,
      artistImage: pool.artist.image,
      totalRounds: pool.tracks.length,
      rounds: [],
      opponentId: isHost ? room.guest_id : room.host_id,
    });

    subscribeRoom(roomId);
    subscribeAnswers();

    await loadRoundsFromRoom(room);

    // Keep polling the room for the whole match — Realtime UPDATEs are not
    // guaranteed to arrive, especially if the guest joined before activation.
    pollRoomSync(roomId);

    return { ok: true };
  },

  submitAnswer: async (answer) => {
    const state = get();
    const round = state.currentRound;
    if (!round || state.roundState !== 'playing' || state.myAnswered) return;

    const responseMs = Date.now() - roundStartRef.at;
    const correct = answer === round.correctAnswer;
    const points = calculatePoints(correct, responseMs);

    set({
      selectedAnswer: answer,
      isCorrect: correct,
      responseTimeMs: responseMs,
      pointsAwarded: points,
      myAnswered: true,
      roundState: 'answered',
    });

    if (state.playerId && round.id) {
      await submitRoundAnswer(
        round.id,
        state.playerId,
        answer,
        responseMs,
        correct,
        points
      );
    }

    // If opponent already answered, resolve immediately.
    if (get().opponentAnswered) {
      resolveRound();
    } else {
      pollForOpponentAnswer(round.id);
    }
  },

  resetGame: () => {
    clearTimers();
    clearPolling();
    roomChannel?.unsubscribe();
    answersChannel?.unsubscribe();
    roomChannel = null;
    answersChannel = null;
    set({
      roomId: '',
      playerId: '',
      opponentId: null,
      isHost: false,
      artistName: '',
      artistImage: '',
      totalRounds: 10,
      rounds: [],
      currentRoundIndex: 0,
      currentRound: null,
      roundState: 'idle',
      countdownValue: 3,
      selectedAnswer: null,
      isCorrect: null,
      responseTimeMs: 0,
      pointsAwarded: 0,
      opponentRoundCorrect: false,
      opponentRoundPoints: 0,
      myAnswered: false,
      opponentAnswered: false,
      playerScore: 0,
      opponentScore: 0,
      playerCorrectCount: 0,
      opponentCorrectCount: 0,
      roundResults: [],
      gameOver: false,
      loading: false,
      error: null,
    });
  },
}));

// ─── Helpers (module scope) ─────────────────────────────────────────────

async function fetchRoom(roomId: string) {
  const { data } = await supabase!
    .from('rooms')
    .select('*')
    .eq('id', roomId)
    .maybeSingle();
  return data;
}

/**
 * Host-only: activates the match the moment the opponent joins. Called both
 * from Realtime updates and the polling fallback so the host's waiting screen
 * gives way to round 1 as soon as the guest arrives. Returns true when the
 * room was (re)activated by this call.
 */
async function maybeActivateHostRoom(room: any): Promise<boolean> {
  const s = useGameStore.getState();
  if (!s.isHost || !s.roomId) return false;
  if (room.status !== 'waiting' || !room.guest_id) return false;
  const res = await s.prepareMatch(s.roomId);
  return res.ok;
}

/**
 * Drives one tick of an "active" room: load rounds on first sight, then start
 * any round the server says has begun. Shared by Realtime + polling so both
 * players react to exactly the same `round_started_at`.
 */
async function processActiveRoom(room: any) {
  const s = useGameStore.getState();
  if (room.status !== 'active' || room.current_round < 1) return;
  if (s.rounds.length === 0) {
    await loadRoundsFromRoom(room);
  } else if (s.currentRoundIndex < room.current_round) {
    beginRound(room.current_round, room.round_started_at);
  }
}

/**
 * Polls the room row for the entire match. Covers everything Realtime
 * websockets would normally deliver, so a match never hard-stalls:
 *  - the opening activation (guest joined before the host pressed Start),
 *  - round-to-round advancement (host bumps `current_round`),
 *  - match completion.
 */
function pollRoomSync(roomId: string) {
  clearStartPoll();
  startPollTimer = setInterval(async () => {
    const s = useGameStore.getState();
    if (s.gameOver) {
      clearStartPoll();
      return;
    }
    const room = await fetchRoom(roomId);
    if (!room) return;
    if (room.status === 'completed') {
      useGameStore.setState({ gameOver: true });
      clearStartPoll();
      return;
    }
    if (room.status === 'waiting') {
      // Host auto-starts the match the moment the opponent joins.
      const activated = await maybeActivateHostRoom(room);
      if (activated) {
        const fresh = await fetchRoom(roomId);
        if (fresh) await processActiveRoom(fresh);
      }
      return;
    }
    await processActiveRoom(room);
  }, POLL_START_MS);
}

/**
 * Polls round_answers while a player is waiting for the opponent to answer.
 * Resolves the round once both answers are present, regardless of websockets.
 */
function pollForOpponentAnswer(roundId: string) {
  clearAnswerPoll();
  answerPollTimer = setInterval(async () => {
    const s = useGameStore.getState();
    const round = s.currentRound;
    if (!round || s.roundState !== 'answered' || s.gameOver) {
      clearAnswerPoll();
      return;
    }
    const answers = await fetchRoundAnswers(roundId);
    const theirs = answers.find((a) => a.player_id !== s.playerId);
    if (theirs) {
      useGameStore.setState({
        opponentAnswered: true,
        opponentRoundCorrect: theirs.is_correct === true,
        opponentRoundPoints: theirs.points_awarded ?? 0,
      });
      if (useGameStore.getState().myAnswered) {
        clearAnswerPoll();
        resolveRound();
      } else {
        clearAnswerPoll();
      }
    }
  }, POLL_ANSWER_MS);
}

function subscribeRoom(roomId: string) {
  roomChannel = supabase!
    .channel(`room:${roomId}`)
    .on(
      'postgres_changes',
      {
        event: 'UPDATE',
        schema: 'public',
        table: 'rooms',
        filter: `id=eq.${roomId}`,
      },
      (payload) => {
        const room = payload.new as any;
        if (room.status === 'waiting') {
          // Host auto-activates as soon as the guest joins the room.
          maybeActivateHostRoom(room);
          return;
        }
        if (room.status === 'active' && room.current_round >= 1) {
          // Guest may not have rounds yet when the host activates the match.
          const s = useGameStore.getState();
          if (s.rounds.length === 0) {
            loadRoundsFromRoom(room);
          } else {
            beginRound(room.current_round, room.round_started_at);
          }
        }
        if (room.status === 'completed') {
          useGameStore.setState({ gameOver: true });
        }
      }
    )
    .subscribe();
}

/**
 * Loads a room's rounds + pool into the store. If the match is already
 * active, starts the current round immediately.
 */
async function loadRoundsFromRoom(room: any) {
  const state = useGameStore.getState();
  const pool = await loadPool(room.track_pool_id);
  if ('error' in pool) return;

  const rounds = await fetchRoundsForRoom(room.id);
  const trackById = new Map(pool.tracks.map((t) => [t.id, t]));
  const gameRounds: GameRound[] = (rounds ?? []).map((r) => ({
    id: r.id,
    roundIndex: r.round_index,
    track: trackById.get(r.track_pool_track_id) ?? null,
    options: r.options,
    correctAnswer: r.correct_answer,
  }));

  useGameStore.setState({
    artistName: pool.artist.name,
    artistImage: pool.artist.image,
    totalRounds: gameRounds.length || pool.tracks.length,
    rounds: gameRounds,
    loading: false,
  });

  if (room.status === 'active' && room.current_round >= 1 && gameRounds.length > 0) {
    clearAnswerPoll();
    beginRound(room.current_round, room.round_started_at);
  }
}

function subscribeAnswers() {
  answersChannel = supabase!
    .channel('round-answers')
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'round_answers' },
      (payload) => {
        const answer = payload.new as any;
        const state = useGameStore.getState();
        if (!state.currentRound || answer.round_id !== state.currentRound.id) return;

        if (answer.player_id === state.playerId) {
          if (!state.myAnswered) {
            useGameStore.setState({
              myAnswered: true,
              selectedAnswer: answer.choice,
              isCorrect: answer.is_correct === true,
              pointsAwarded: answer.points_awarded ?? 0,
              responseTimeMs: answer.response_ms ?? 0,
              roundState: 'answered',
            });
          }
        } else {
          useGameStore.setState({
            opponentAnswered: true,
            opponentRoundCorrect: answer.is_correct === true,
            opponentRoundPoints: answer.points_awarded ?? 0,
          });
        }

        const s = useGameStore.getState();
        if (s.myAnswered && s.opponentAnswered) {
          resolveRound();
        }
      }
    )
    .subscribe();
}

function beginRound(roundIndex: number, roundStartedAt: string | null) {
  const state = useGameStore.getState();
  if (roundIndex < 1 || roundIndex > state.totalRounds) return;
  if (state.rounds.length === 0) return;

  const round = state.rounds.find((r) => r.roundIndex === roundIndex);
  if (!round) return;

  // Guard against double-starting the same round (initGame + realtime UPDATE).
  if (
    state.currentRoundIndex === roundIndex &&
    state.roundState !== 'idle' &&
    state.roundState !== 'result'
  ) {
    return;
  }

  clearTimers();
  clearAnswerPoll();

  const startedAtMs = roundStartedAt
    ? new Date(roundStartedAt).getTime()
    : Date.now();
  const now = Date.now();

  // Anchor timing to the server's `round_started_at` so both players hit the
  // same countdown → clip-start → guess-cutoff wall-clock times. `min` with
  // `now` guards against device-clock skew: a client that observes the room
  // from a "future" timestamp (its clock behind the host's) would otherwise
  // wait far too long and look frozen on "3".
  const roundStartMs = Math.min(startedAtMs, now) + COUNTDOWN_MS;
  const roundBaseMs = roundStartMs - COUNTDOWN_MS;
  const until = (targetMs: number) => Math.max(0, targetMs - now);

  useGameStore.setState({
    currentRoundIndex: roundIndex,
    currentRound: round,
    roundState: 'countdown',
    countdownValue: 3,
    selectedAnswer: null,
    isCorrect: null,
    responseTimeMs: 0,
    pointsAwarded: 0,
    opponentRoundCorrect: false,
    opponentRoundPoints: 0,
    myAnswered: false,
    opponentAnswered: false,
  });

  // Seed answered state from DB (reconnect safety).
  seedRoundAnswers(round.id);

  later(
    () => useGameStore.setState({ countdownValue: 2 }),
    until(roundBaseMs + 1000)
  );
  later(
    () => useGameStore.setState({ countdownValue: 1 }),
    until(roundBaseMs + 2000)
  );
  later(() => {
    roundStartRef.at = roundStartMs;
    useGameStore.setState({ roundState: 'playing' });

    // Auto-answer on timeout (empty = incorrect).
    later(() => {
      const s = useGameStore.getState();
      if (s.roundState === 'playing' && !s.myAnswered) {
        useGameStore.setState({
          myAnswered: true,
          selectedAnswer: '',
          isCorrect: false,
          pointsAwarded: 0,
          responseTimeMs: ROUND_DURATION_MS,
          roundState: 'answered',
        });
        if (s.playerId && s.currentRound?.id) {
          submitRoundAnswer(
            s.currentRound.id,
            s.playerId,
            '',
            ROUND_DURATION_MS,
            false,
            0
          );
        }
        if (useGameStore.getState().opponentAnswered) {
          resolveRound();
        } else if (s.currentRound?.id) {
          pollForOpponentAnswer(s.currentRound.id);
        }
      }
    }, until(roundStartMs + ROUND_DURATION_MS + 500));
  }, until(roundStartMs));
}

async function seedRoundAnswers(roundId: string) {
  const answers = await fetchRoundAnswers(roundId);
  const state = useGameStore.getState();
  const mine = answers.find((a) => a.player_id === state.playerId);
  const theirs = answers.find((a) => a.player_id !== state.playerId);

  if (mine) {
    useGameStore.setState({
      myAnswered: true,
      selectedAnswer: mine.choice,
      isCorrect: mine.is_correct,
      pointsAwarded: mine.points_awarded ?? 0,
      responseTimeMs: mine.response_ms ?? 0,
    });
  }
  if (theirs) {
    useGameStore.setState({
      opponentAnswered: true,
      opponentRoundCorrect: theirs.is_correct === true,
      opponentRoundPoints: theirs.points_awarded ?? 0,
    });
  }

  const s = useGameStore.getState();
  if (s.myAnswered && s.opponentAnswered && s.roundState !== 'result') {
    resolveRound();
  }
}

function resolveRound() {
  const state = useGameStore.getState();
  const round = state.currentRound;
  if (!round || state.roundState === 'result') return;

  const result: RoundResult = {
    roundIndex: round.roundIndex,
    playerAnswer: state.selectedAnswer || null,
    playerCorrect: state.isCorrect ?? false,
    playerPoints: state.pointsAwarded,
    opponentCorrect: state.opponentRoundCorrect,
    opponentPoints: state.opponentRoundPoints,
  };

  useGameStore.setState({
    roundState: 'result',
    playerScore: state.playerScore + state.pointsAwarded,
    opponentScore: state.opponentScore + state.opponentRoundPoints,
    playerCorrectCount:
      state.playerCorrectCount + (state.isCorrect ? 1 : 0),
    opponentCorrectCount:
      state.opponentCorrectCount + (state.opponentRoundCorrect ? 1 : 0),
    roundResults: [...state.roundResults, result],
  });

  clearAnswerPoll();

  // Auto-advance after result is shown.
  later(() => {
    const s = useGameStore.getState();
    if (s.currentRoundIndex >= s.totalRounds) {
      finalizeMatch();
    } else if (s.isHost) {
      advanceRoomRound();
    }
    // Guest waits for host's rooms UPDATE via realtime.
  }, 2200);
}

async function advanceRoomRound() {
  const state = useGameStore.getState();
  const next = state.currentRoundIndex + 1;
  const { error } = await supabase!
    .from('rooms')
    .update({
      current_round: next,
      round_started_at: new Date().toISOString(),
    })
    .eq('id', state.roomId)
    .eq('current_round', state.currentRoundIndex); // guard against double advance
  if (error) {
    console.warn('[game] advance failed', error.message);
  }
}

async function finalizeMatch() {
  const state = useGameStore.getState();

  // Authoritative scores from DB.
  const room = await fetchRoom(state.roomId);
  if (room) {
    const { data } = await supabase!
      .from('round_answers')
      .select('player_id, is_correct, points_awarded, response_ms')
      .in('round_id', state.rounds.map((r) => r.id));

    let pScore = 0;
    let pCorrect = 0;
    let oScore = 0;
    let oCorrect = 0;
    const pTimes: number[] = [];
    const oTimes: number[] = [];
    for (const a of data ?? []) {
      const mine = a.player_id === state.playerId;
      const pts = a.points_awarded ?? 0;
      const ok = a.is_correct === true;
      if (mine) {
        pScore += pts;
        pCorrect += ok ? 1 : 0;
        if (a.response_ms != null) pTimes.push(a.response_ms);
      } else {
        oScore += pts;
        oCorrect += ok ? 1 : 0;
        if (a.response_ms != null) oTimes.push(a.response_ms);
      }
    }

    const avg = (arr: number[]) =>
      arr.length ? Math.round(arr.reduce((a, b) => a + b, 0) / arr.length) : 0;
    const outcome = pScore > oScore ? 'win' : pScore < oScore ? 'loss' : 'draw';

    useGameStore.setState({
      playerScore: pScore,
      opponentScore: oScore,
      playerCorrectCount: pCorrect,
      opponentCorrectCount: oCorrect,
      gameOver: true,
    });

    if (state.playerId) {
      await supabase!.from('match_results').upsert(
        {
          room_id: state.roomId,
          player_id: state.playerId,
          total_score: pScore,
          correct_count: pCorrect,
          avg_response_ms: avg(pTimes),
          outcome,
        },
        { onConflict: 'room_id,player_id' }
      );
      if (state.opponentId) {
        await supabase!.from('match_results').upsert(
          {
            room_id: state.roomId,
            player_id: state.opponentId,
            total_score: oScore,
            correct_count: oCorrect,
            avg_response_ms: avg(oTimes),
            outcome: pScore > oScore ? 'loss' : pScore < oScore ? 'win' : 'draw',
          },
          { onConflict: 'room_id,player_id' }
        );
      }
    }
  }

  const { error } = await supabase!
    .from('rooms')
    .update({ status: 'completed' })
    .eq('id', state.roomId);
  if (error) console.warn('[game] complete failed', error.message);
}
