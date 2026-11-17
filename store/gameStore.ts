import { create } from 'zustand';
import { AppState } from 'react-native';
import type { NativeEventSubscription } from 'react-native';
import { supabase, onRealtimeHeartbeat } from '../lib/supabase';
import type { RealtimeChannel } from '@supabase/supabase-js';
import type { RoomPoolTrack } from '../services/rooms';
import { loadPool } from '../services/rooms';
import { preloadClip, preloadCover, clearClips } from '../services/clipCache';
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
  /** Elo rating after this match and the change it caused (from finalize_match). */
  myRating: number | null;
  myRatingChange: number | null;

  // Round history
  roundResults: RoundResult[];
  gameOver: boolean;
  loading: boolean;
  error: string | null;

  // Connectivity
  /** waiting: not seen yet · connected · reconnecting: silent or app in
   *  background · left: exited or gone too long · absent: the host never
   *  showed up after the guest joined. */
  opponentStatus: OpponentStatus;
  /** This phone's own link to the game channel. */
  selfConnection: 'connected' | 'reconnecting';

  // Actions
  prepareMatch: (
    roomId: string
  ) => Promise<{ ok: boolean; error?: string; startAtHost?: number }>;
  initGame: (roomId: string, isHost: boolean) => Promise<{ ok: boolean; error?: string }>;
  submitAnswer: (answer: string) => Promise<void>;
  /** Exit mid-match: tells the opponent right away, then tears down. */
  leaveMatch: () => void;
  resetGame: () => void;
}

export type OpponentStatus =
  | 'waiting'
  | 'connected'
  | 'reconnecting'
  | 'left'
  | 'ended'
  | 'absent';

function calculatePoints(isCorrect: boolean, responseMs: number): number {
  if (!isCorrect) return 0;
  const basePoints = 100;
  // Multiply first, exactly like grade_round_answer on the server:
  // (ms / 8000) * 100 can land on 28.999… and give a 1-point different bonus.
  const ms = Math.min(Math.max(Math.round(responseMs), 0), ROUND_DURATION_MS);
  const speedBonus = Math.max(0, 100 - Math.floor((ms * 100) / ROUND_DURATION_MS));
  return basePoints + speedBonus;
}

const roundStartRef = { at: 0 }; // Date.now() when the clip started playing

/** Local-clock ms at which the current round's clip is meant to start — the
 *  same instant on both phones thanks to the clock sync. */
export function getRoundStartAt(): number {
  return roundStartRef.at;
}

/** Buffers the clips for rounds `fromIndex`..`fromIndex + count - 1`. */
function preloadRounds(fromIndex: number, count: number) {
  const { rounds } = useGameStore.getState();
  for (let i = fromIndex; i < fromIndex + count; i++) {
    const track = rounds.find((r) => r.roundIndex === i)?.track;
    preloadClip(track?.preview_url);
    preloadCover(track?.album_art_url);
  }
}

/** Minimum time the round result (and revealed cover) stays on screen. */
const RESULT_MS = 2200;
/** Longest extra wait for covers to finish loading before moving on. */
const COVER_WAIT_MAX_MS = 3000;

/** Host side: resolvers for the guest's "cover is showing" signal, per round. */
const guestCoverReady = new Map<number, { promise: Promise<void>; resolve: () => void }>();
function guestCoverSignal(roundIndex: number) {
  let entry = guestCoverReady.get(roundIndex);
  if (!entry) {
    let resolve!: () => void;
    const promise = new Promise<void>((r) => (resolve = r));
    entry = { promise, resolve };
    guestCoverReady.set(roundIndex, entry);
  }
  return entry;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

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

/**
 * One Realtime channel per room carries everything time-critical:
 *  - Broadcast messages sent phone-to-phone (no DB round trip): hello,
 *    clock-sync ping/pong, round starts and answers.
 *  - postgres_changes on the room row, kept as a backup signal.
 * DB writes still happen for persistence/reconnects, and polling remains as a
 * slow safety net, but neither is on the critical path any more.
 */
let gameChannel: RealtimeChannel | null = null;

/** Head start given to a round so the broadcast reaches the guest before the
 *  countdown begins on both phones. */
const ROUND_LEAD_MS = 500;
/** Round 1 gets a longer head start: the guest has just arrived and still
 *  needs to sync clocks, load the rounds and start the first clip download. */
const ROUND1_LEAD_MS = 2000;

/**
 * Clock sync. The host is the timekeeper; the guest estimates
 * `hostClock - localClock` with NTP-style ping/pong over Broadcast and keeps
 * the sample with the lowest round-trip (least network noise). Round start
 * times are expressed in host-clock ms, so device clock skew no longer matters.
 */
let clockOffsetMs: number | null = null;
let bestSyncRttMs = Infinity;

/** Timing of the round currently on screen, so a precisely-synced start can
 *  replace an earlier unsynced (fallback) start of the same round. */
let roundTiming = { index: 0, synced: false, startAtLocal: 0 };

/** Pool is loaded once per match and reused (it was refetched up to 3x). */
type LoadedPool = Exclude<Awaited<ReturnType<typeof loadPool>>, { error: string }>;
let poolCache: { id: string; pool: LoadedPool } | null = null;
async function getPool(poolId: string): Promise<LoadedPool | { error: string }> {
  if (poolCache?.id === poolId) return poolCache.pool;
  const pool = await loadPool(poolId);
  if (!('error' in pool)) poolCache = { id: poolId, pool };
  return pool;
}

function teardownChannel() {
  stopPresence();
  if (gameChannel) supabase?.removeChannel(gameChannel);
  gameChannel = null;
}

// ─── Presence: is the other player still here? ─────────────────────────

/** Heartbeat interval; any broadcast from the opponent also counts. */
const HEARTBEAT_MS = 2000;
/** Silence before showing "reconnecting" and pausing the match. */
const OPPONENT_LOST_MS = 6000;
/** Silence before giving up: the opponent has left. */
const OPPONENT_GONE_MS = 60000;
/** Guest only: how long to wait for the host to appear after joining. */
const HOST_ABSENT_MS = 20000;

let presenceTimer: ReturnType<typeof setInterval> | null = null;
let appStateSub: NativeEventSubscription | null = null;
let lastOpponentSeen = 0;
let opponentSeen = false;
let opponentLeftOnPurpose = false;
let presenceStartedAt = 0;

function setOpponentStatus(status: OpponentStatus) {
  if (useGameStore.getState().opponentStatus !== status) {
    useGameStore.setState({ opponentStatus: status });
  }
}

let lastEndNotice = 0;

/** Called for every message the opponent sends: proof they're still here. */
function touchOpponent() {
  lastOpponentSeen = Date.now();
  opponentSeen = true;
  if (opponentLeftOnPurpose) {
    // We already ended this match (they were gone too long). They're back:
    // tell them, so their screen doesn't sit "connected" on a dead match.
    if (Date.now() - lastEndNotice > 5000) {
      lastEndNotice = Date.now();
      sendPresence('leave', 'timeout');
    }
    return;
  }
  const wasAway = useGameStore.getState().opponentStatus === 'reconnecting';
  setOpponentStatus('connected');
  // They're back: whatever we sent while they were away never reached them.
  if (wasAway) resyncGame();
}

// ─── Resync after a drop ────────────────────────────────────────────────

/** DB writes that failed (usually offline), retried after reconnecting. */
let pendingWrites: Array<() => Promise<boolean>> = [];

function queueWrite(write: () => Promise<boolean>) {
  pendingWrites.push(write);
}

async function flushPendingWrites() {
  const writes = pendingWrites;
  pendingWrites = [];
  for (const write of writes) {
    let ok = false;
    try {
      ok = await write();
    } catch {}
    if (!ok) pendingWrites.push(write);
  }
}

/** Saves an answer; on failure it is queued and retried after reconnecting. */
async function persistAnswer(
  roundId: string,
  playerId: string,
  choice: string,
  responseMs: number,
  correct: boolean,
  points: number
) {
  const write = async () => {
    const res = await submitRoundAnswer(roundId, playerId, choice, responseMs, correct, points);
    // A duplicate (unique round_id+player_id) means it already landed.
    return res.ok || /duplicate|unique/i.test(res.error ?? '');
  };
  if (!(await write().catch(() => false))) queueWrite(write);
}

let lastResyncAt = 0;

/**
 * Broadcasts are fire-and-forget, so anything sent while either phone was
 * offline is simply gone — e.g. an answer, which left the opponent waiting
 * forever. After a reconnect (ours or theirs) send the current state again.
 * Receivers ignore duplicates (applyOpponentAnswer, beginRound guards).
 */
function resyncGame() {
  const s = useGameStore.getState();
  if (!s.roomId || s.gameOver || opponentLeftOnPurpose) return;
  if (Date.now() - lastResyncAt < 1500) return;
  lastResyncAt = Date.now();

  void flushPendingWrites();

  const round = s.currentRound;
  if (round && s.myAnswered && (s.roundState === 'answered' || s.roundState === 'result')) {
    sendAnswer(
      round.id,
      s.playerId,
      s.selectedAnswer ?? '',
      s.isCorrect === true,
      s.pointsAwarded,
      s.responseTimeMs
    );
  }
  if (s.isHost && s.currentRoundIndex >= 1 && roundTiming.index === s.currentRoundIndex) {
    gameChannel?.send({
      type: 'broadcast',
      event: 'round',
      payload: { roundIndex: s.currentRoundIndex, startAtHost: roundTiming.startAtLocal },
    });
  }
  if (!s.isHost && round && s.roundState === 'result') {
    gameChannel?.send({
      type: 'broadcast',
      event: 'cover-ready',
      payload: { roundIndex: round.roundIndex },
    });
  }
  // Catch up on anything the room moved past while we were away.
  fetchRoom(s.roomId).then((room) => room && onRoomRow(room));
  if (round && s.roundState === 'answered' && !s.opponentAnswered) {
    pollForOpponentAnswer(round.id);
  }
}

function sendPresence(event: 'hb' | 'away' | 'leave', reason?: 'timeout') {
  gameChannel?.send({
    type: 'broadcast',
    event,
    payload: { from: useGameStore.getState().playerId, reason },
  });
}

function startPresence() {
  stopPresence();
  lastOpponentSeen = 0;
  opponentSeen = false;
  opponentLeftOnPurpose = false;
  lastEndNotice = 0;
  presenceStartedAt = Date.now();

  lastSocketOk = Date.now();
  presenceTimer = setInterval(() => {
    void presenceTick();
  }, HEARTBEAT_MS);

  // The socket's own heartbeat is the earliest sign *we* lost the network.
  heartbeatUnsub = onRealtimeHeartbeat((status) => {
    if (status === 'ok') {
      lastSocketOk = Date.now();
    } else if (status === 'timeout' || status === 'disconnected' || status === 'error') {
      if (!recovering) goOffline();
    }
  });

  // Backgrounding freezes JS (no heartbeats), so say so explicitly; on
  // return, announce ourselves again so the opponent resumes at once.
  appStateSub = AppState.addEventListener('change', (state) => {
    if (useGameStore.getState().gameOver) return;
    if (state === 'background') sendPresence('away');
    else if (state === 'active') {
      // Our timers were frozen too: give the opponent a fresh window rather
      // than counting our own time away as their silence.
      lastOpponentSeen = Date.now();
      presenceStartedAt = Date.now();
      sendPresence('hb');
      sendHello(false);
    }
  });
}

function stopPresence() {
  if (presenceTimer) clearInterval(presenceTimer);
  presenceTimer = null;
  appStateSub?.remove();
  appStateSub = null;
  heartbeatUnsub?.();
  heartbeatUnsub = null;
}

/** No socket heartbeat answer for this long ⇒ our socket is stale. */
const SOCKET_STALE_MS = 12000;
let lastSocketOk = 0;
let heartbeatUnsub: (() => void) | null = null;
let recovering = false;
let lastRecoverAt = 0;

/** This phone lost its link: show "You're offline", never blame the opponent. */
function goOffline() {
  const s = useGameStore.getState();
  if (!s.roomId || s.gameOver) return;
  lastOpponentSeen = Date.now();
  if (s.selfConnection !== 'reconnecting') {
    useGameStore.setState({ selfConnection: 'reconnecting' });
  }
}

/**
 * Can this phone reach Supabase right now? A tiny HEAD request with a 3s
 * cap; any HTTP answer (even an error status) means the network is up.
 */
let probeInFlight: Promise<boolean> | null = null;
function probeNetwork(): Promise<boolean> {
  if (!supabase) return Promise.resolve(false);
  if (probeInFlight) return probeInFlight;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 3000);
  probeInFlight = (async () => {
    try {
      const { status } = await supabase!
        .from('rooms')
        .select('id', { head: true })
        .limit(1)
        .abortSignal(ctrl.signal);
      return status > 0;
    } catch {
      return false;
    } finally {
      clearTimeout(timer);
      probeInFlight = null;
    }
  })();
  return probeInFlight;
}

/**
 * Network is back but the channel isn't: drop the (likely stale) socket and
 * join the game channel afresh, keeping presence and match state intact.
 * Waiting for the library to notice its dead socket was the slow part.
 */
async function recoverChannel() {
  const roomId = useGameStore.getState().roomId;
  if (!supabase || !roomId || recovering || Date.now() - lastRecoverAt < 4000) return;
  recovering = true;
  lastRecoverAt = Date.now();
  try {
    const old = gameChannel;
    gameChannel = null; // its CLOSED callback is now ignored
    if (old) await supabase.removeChannel(old).catch(() => {});
    await supabase.realtime.disconnect().catch(() => {});
    if (useGameStore.getState().roomId !== roomId) return; // left meanwhile
    subscribeGameChannel(roomId, false); // subscribe() reconnects the socket
  } finally {
    recovering = false;
  }
}

/** One presence step: heartbeat out, then judge who (if anyone) is gone. */
async function presenceTick() {
  const s = useGameStore.getState();
  if (s.gameOver || !s.roomId) return;
  const now = Date.now();

  // While *we* are offline, silence from the opponent proves nothing:
  // freeze their window, keep checking our own network, rejoin when it's up.
  if (s.selfConnection !== 'connected') {
    lastOpponentSeen = now;
    presenceStartedAt = now;
    if (await probeNetwork()) recoverChannel();
    return;
  }
  sendPresence('hb');

  // Network fine but our socket stopped answering heartbeats: it's stale.
  if (now - lastSocketOk > SOCKET_STALE_MS) {
    goOffline();
    if (await probeNetwork()) recoverChannel();
    return;
  }

  if (!opponentSeen) {
    // The host can wait in the lobby indefinitely; a guest whose host
    // never answers may be in a dead room.
    if (!s.isHost && now - presenceStartedAt > HOST_ABSENT_MS) setOpponentStatus('absent');
    return;
  }
  if (opponentLeftOnPurpose) return;
  const silent = now - lastOpponentSeen;
  if (silent <= OPPONENT_LOST_MS) return;

  // Before blaming the opponent, make sure it isn't us.
  if (!(await probeNetwork())) {
    goOffline();
    return;
  }
  if (opponentLeftOnPurpose || useGameStore.getState().selfConnection !== 'connected') return;
  if (silent > OPPONENT_GONE_MS) {
    markOpponentGone('left');
    // If they come back later, touchOpponent tells them the match ended.
    sendPresence('leave', 'timeout');
    lastEndNotice = Date.now();
  } else {
    setOpponentStatus('reconnecting');
  }
}

/** The opponent is gone for good: stop the match so nothing plays on alone. */
function markOpponentGone(status: 'left' | 'ended') {
  // Final for this match: a late heartbeat must not revive a stopped game.
  opponentLeftOnPurpose = true;
  setOpponentStatus(status);
  clearTimers();
  clearPolling();
}

/** Resolves once the opponent is connected; never resolves if they left. */
function waitForOpponent(): Promise<void> {
  if (useGameStore.getState().opponentStatus === 'connected') return Promise.resolve();
  return new Promise((resolve) => {
    const unsub = useGameStore.subscribe((s) => {
      if (s.opponentStatus === 'connected') {
        unsub();
        resolve();
      } else if (s.opponentStatus === 'left' || s.opponentStatus === 'ended' || s.gameOver || !s.roomId) {
        unsub();
      }
    });
  });
}

function resetSyncState() {
  clockOffsetMs = null;
  bestSyncRttMs = Infinity;
  syncPromise = null;
  roundTiming = { index: 0, synced: false, startAtLocal: 0 };
  poolCache = null;
  earlyAnswers.clear();
  guestCoverReady.clear();
  pendingWrites = [];
  lastResyncAt = 0;
  clearClips();
}

/** Coalesces concurrent `prepareMatch` calls (Realtime + polling) so the host
 *  only ever generates rounds / activates the room once. */
let activationPromise: Promise<{
  ok: boolean;
  error?: string;
  startAtHost?: number;
}> | null = null;

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
  myRating: null,
  myRatingChange: null,
  roundResults: [],
  gameOver: false,
  loading: false,
  error: null,
  opponentStatus: 'waiting',
  selfConnection: 'connected',

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

      const pool = await getPool(room.track_pool_id);
      if ('error' in pool) return { ok: false, error: pool.error };

      const existing = await fetchRoundsForRoom(roomId);
      if (!existing || existing.length === 0) {
        const gen = await generateRoundsForRoom(roomId, pool.tracks, pool.options);
        if (!gen.ok) return { ok: false, error: gen.error };
      }

      // Have the rounds in memory before picking the start time, so the only
      // thing eating into the lead is the activation write itself.
      if (get().rounds.length === 0) {
        await loadRounds(roomId, room.track_pool_id);
      }

      // round_started_at is the moment the round-1 countdown begins, on the
      // host's clock. The guest converts it with its clock offset, so even the
      // DB/polling fallback path starts both phones together.
      const startAtHost = Date.now() + ROUND1_LEAD_MS;
      const { data: activated, error } = await supabase
        .from('rooms')
        .update({
          status: 'active',
          current_round: 1,
          round_started_at: new Date(startAtHost).toISOString(),
        })
        .eq('id', roomId)
        .eq('status', 'waiting') // only the first activation wins
        .select('id');
      if (error) return { ok: false, error: error.message };
      if (!activated || activated.length === 0) {
        return { ok: false, error: 'Room already active' };
      }

      return { ok: true, startAtHost };
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
    teardownChannel();
    resetSyncState();

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
      myRating: null,
      myRatingChange: null,
      roundResults: [],
      myAnswered: false,
      opponentAnswered: false,
      opponentStatus: 'waiting',
      selfConnection: 'connected',
    });

    const room = await fetchRoom(roomId);
    if (!room) {
      set({ loading: false, error: 'Room not found' });
      return { ok: false, error: 'Room not found' };
    }

    const pool = await getPool(room.track_pool_id);
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

    subscribeGameChannel(roomId);

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

    // Tell the opponent instantly, then persist. Resolution no longer waits
    // on the DB insert (or on the opponent noticing it).
    sendAnswer(round.id, state.playerId, answer, correct, points, responseMs);

    if (get().opponentAnswered) {
      resolveRound();
    } else {
      pollForOpponentAnswer(round.id);
    }

    if (state.playerId && round.id) {
      await persistAnswer(round.id, state.playerId, answer, responseMs, correct, points);
    }
  },

  leaveMatch: () => {
    const s = get();
    // Tell the opponent first so their screen updates instantly instead of
    // waiting out the heartbeat timeout. The channel is detached before the
    // reset and only removed once the message is out.
    const ch = gameChannel;
    if (ch && s.roomId && !s.gameOver) {
      gameChannel = null;
      stopPresence();
      ch.send({ type: 'broadcast', event: 'leave', payload: { from: s.playerId } })
        .catch(() => {})
        .finally(() => supabase?.removeChannel(ch));
    }
    get().resetGame();
  },

  resetGame: () => {
    clearTimers();
    clearPolling();
    teardownChannel();
    resetSyncState();
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
      myRating: null,
      myRatingChange: null,
      roundResults: [],
      gameOver: false,
      loading: false,
      error: null,
      opponentStatus: 'waiting',
      selfConnection: 'connected',
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
  if (!res.ok || res.startAtHost == null) return false;
  // Kick off round 1 right now on both phones — don't wait for our own DB
  // write to echo back through Realtime or the next poll tick.
  startRoundAsHost(1, res.startAtHost);
  return true;
}

/** Parses a `round_started_at` ISO string into host-clock ms. */
function parseHostTime(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : null;
}

/**
 * Converts a host-clock start time into this phone's clock. Times that are
 * already well past (a reconnect mid-match) or implausibly far ahead fall back
 * to "start now", which is the old behaviour.
 */
function resolveStartLocal(startAtHost: number | null | undefined): {
  at: number;
  synced: boolean;
} {
  const now = Date.now();
  if (startAtHost != null) {
    const local = useGameStore.getState().isHost
      ? startAtHost
      : clockOffsetMs == null
        ? null
        : startAtHost - clockOffsetMs;
    if (local != null && local > now - COUNTDOWN_MS && local < now + 5000) {
      return { at: local, synced: true };
    }
  }
  return { at: now, synced: false };
}

/** Host: announce a round to the guest over Broadcast and start it locally. */
function startRoundAsHost(roundIndex: number, startAtHost: number) {
  gameChannel?.send({
    type: 'broadcast',
    event: 'round',
    payload: { roundIndex, startAtHost },
  });
  beginRound(roundIndex, startAtHost);
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
  } else if (s.currentRoundIndex <= room.current_round) {
    beginRound(room.current_round, parseHostTime(room.round_started_at));
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

/** Room-row changes, from postgres_changes or polling. */
function onRoomRow(room: any) {
  if (!room) return;
  if (room.status === 'waiting') {
    // Host auto-activates as soon as the guest joins the room.
    maybeActivateHostRoom(room);
    return;
  }
  if (room.status === 'completed') {
    useGameStore.setState({ gameOver: true });
    return;
  }
  processActiveRoom(room);
}

/**
 * Subscribes to the room's single Realtime channel. Broadcast traffic goes
 * phone-to-phone through the Realtime server without touching Postgres, so a
 * message lands in roughly one network hop instead of
 * write → WAL → postgres_changes → RLS check → client (or the next poll tick).
 */
function subscribeGameChannel(roomId: string, freshPresence = true) {
  const ch = supabase!.channel(`game:${roomId}`, {
    config: { broadcast: { self: false, ack: false } },
  });
  const isCurrent = () => gameChannel === ch;
  const me = () => useGameStore.getState().playerId;

  // Presence: every message from the opponent is proof of life (touchOpponent
  // is called in each handler below); these three exist only for presence.
  ch.on('broadcast', { event: 'hb' }, ({ payload }) => {
    if (isCurrent() && payload?.from !== me()) touchOpponent();
  })
    .on('broadcast', { event: 'away' }, ({ payload }) => {
      if (!isCurrent() || payload?.from === me()) return;
      // App went to the background: likely back soon, so pause, don't end.
      lastOpponentSeen = Date.now();
      if (!opponentLeftOnPurpose) setOpponentStatus('reconnecting');
    })
    .on('broadcast', { event: 'leave' }, ({ payload }) => {
      if (!isCurrent() || payload?.from === me()) return;
      if (useGameStore.getState().gameOver || opponentLeftOnPurpose) return;
      // 'timeout' = they gave up on *us* while we were away.
      markOpponentGone(payload?.reason === 'timeout' ? 'ended' : 'left');
    })
    .on('broadcast', { event: 'hello' }, ({ payload }) => {
    if (!isCurrent() || payload?.from === me()) return;
    touchOpponent();
    const s = useGameStore.getState();
    // Answer a first hello so whoever subscribed first still hears from us.
    if (!payload?.reply) sendHello(true);
    if (s.isHost) {
      // The guest is in the room — activate now rather than on the next poll.
      fetchRoom(roomId).then((room) => room && onRoomRow(room));
    } else {
      runClockSync();
    }
  })
    .on('broadcast', { event: 'ping' }, ({ payload }) => {
      if (!isCurrent() || !useGameStore.getState().isHost) return;
      touchOpponent();
      ch.send({
        type: 'broadcast',
        event: 'pong',
        payload: { t0: payload.t0, th: Date.now(), to: payload.from },
      });
    })
    .on('broadcast', { event: 'pong' }, ({ payload }) => {
      if (!isCurrent() || payload?.to !== me()) return;
      touchOpponent();
      const t1 = Date.now();
      const rtt = t1 - payload.t0;
      if (rtt >= 0 && rtt < bestSyncRttMs) {
        bestSyncRttMs = rtt;
        // Assume the pong was stamped halfway through the round trip.
        clockOffsetMs = payload.th - (payload.t0 + rtt / 2);
      }
    })
    .on('broadcast', { event: 'round' }, async ({ payload }) => {
      if (!isCurrent()) return;
      const s = useGameStore.getState();
      if (s.isHost || s.gameOver) return;
      touchOpponent();
      if (opponentLeftOnPurpose) return;
      if (s.rounds.length === 0) {
        const poolId = poolCache?.id ?? (await fetchRoom(roomId))?.track_pool_id;
        if (poolId) await loadRounds(roomId, poolId);
      }
      await ensureClockSync();
      beginRound(payload.roundIndex, payload.startAtHost);
    })
    .on('broadcast', { event: 'cover-ready' }, ({ payload }) => {
      if (!isCurrent() || !useGameStore.getState().isHost) return;
      touchOpponent();
      guestCoverSignal(payload.roundIndex).resolve();
    })
    .on('broadcast', { event: 'answer' }, ({ payload }) => {
      if (!isCurrent() || payload?.playerId === me()) return;
      touchOpponent();
      applyOpponentAnswer(payload.roundId, payload.correct === true, payload.points ?? 0);
    })
    .on(
      'postgres_changes',
      {
        event: 'UPDATE',
        schema: 'public',
        table: 'rooms',
        filter: `id=eq.${roomId}`,
      },
      (payload) => {
        if (isCurrent()) onRoomRow(payload.new);
      }
    )
    .subscribe((status) => {
      if (!isCurrent()) return;
      // Our own link: Realtime rejoins by itself after drops; show it.
      if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
        useGameStore.setState({ selfConnection: 'reconnecting' });
        return;
      }
      if (status !== 'SUBSCRIBED') return;
      const wasOffline = useGameStore.getState().selfConnection === 'reconnecting' || !freshPresence;
      useGameStore.setState({ selfConnection: 'connected' });
      // Back online: start the opponent's silence window afresh.
      lastOpponentSeen = Date.now();
      lastSocketOk = Date.now();
      sendHello(false);
      // Anything we sent while offline was lost: send the current state again.
      if (wasOffline) resyncGame();
      if (useGameStore.getState().isHost) {
        // The guest may have joined before we subscribed.
        fetchRoom(roomId).then((room) => room && onRoomRow(room));
      } else {
        runClockSync();
      }
    });

  gameChannel = ch;
  // A rejoin after a network drop keeps the opponent/match bookkeeping.
  if (freshPresence) startPresence();
}

function sendHello(reply: boolean) {
  gameChannel?.send({
    type: 'broadcast',
    event: 'hello',
    payload: { from: useGameStore.getState().playerId, reply },
  });
}

/** Guest: a short burst of pings to the host; the best sample wins. */
let syncPromise: Promise<void> | null = null;
function runClockSync(): Promise<void> {
  if (useGameStore.getState().isHost) return Promise.resolve();
  if (syncPromise) return syncPromise;
  const PINGS = 6;
  syncPromise = new Promise<void>((resolve) => {
    for (let i = 0; i < PINGS; i++) {
      setTimeout(() => {
        gameChannel?.send({
          type: 'broadcast',
          event: 'ping',
          payload: { t0: Date.now(), from: useGameStore.getState().playerId },
        });
      }, i * 120);
    }
    // Leave time for the last pong to come back.
    setTimeout(() => {
      syncPromise = null;
      resolve();
    }, PINGS * 120 + 400);
  });
  return syncPromise;
}

/**
 * Guest: make sure we know the host's clock before scheduling a round.
 * Without it, round 1 (which a direct challenge starts almost instantly)
 * fell back to "start when the message arrives" and ran out of step with
 * the host until the sync finished by round 2.
 */
async function ensureClockSync() {
  if (useGameStore.getState().isHost || clockOffsetMs != null) return;
  await Promise.race([runClockSync(), sleep(1500)]);
}

function sendAnswer(
  roundId: string,
  playerId: string,
  choice: string,
  correct: boolean,
  points: number,
  responseMs: number
) {
  gameChannel?.send({
    type: 'broadcast',
    event: 'answer',
    payload: { roundId, playerId, choice, correct, points, responseMs },
  });
}

/** Opponent answers that arrived before this phone started that round. */
const earlyAnswers = new Map<string, { correct: boolean; points: number }>();

function applyOpponentAnswer(roundId: string, correct: boolean, points: number) {
  const s = useGameStore.getState();
  if (!s.currentRound || s.currentRound.id !== roundId) {
    earlyAnswers.set(roundId, { correct, points });
    return;
  }
  if (s.opponentAnswered) return;
  useGameStore.setState({
    opponentAnswered: true,
    opponentRoundCorrect: correct,
    opponentRoundPoints: points,
  });
  if (useGameStore.getState().myAnswered) resolveRound();
}

/** Loads a room's rounds into the store (pool comes from the cache). */
async function loadRounds(roomId: string, poolId: string): Promise<boolean> {
  const pool = await getPool(poolId);
  if ('error' in pool) return false;

  const rounds = await fetchRoundsForRoom(roomId);
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
  // Start buffering the opening clips now, well before round 1's countdown.
  preloadRounds(Math.max(1, useGameStore.getState().currentRoundIndex), 3);
  return gameRounds.length > 0;
}

/**
 * Loads a room's rounds + pool into the store. If the match is already
 * active, starts the current round immediately.
 */
async function loadRoundsFromRoom(room: any) {
  const loaded = await loadRounds(room.id, room.track_pool_id);
  if (loaded && room.status === 'active' && room.current_round >= 1) {
    clearAnswerPoll();
    await ensureClockSync();
    beginRound(room.current_round, parseHostTime(room.round_started_at));
  }
}

/**
 * Starts a round's countdown at `startAtHost` (host-clock ms). Both phones
 * receive the same host timestamp and convert it with their clock offset, so
 * the countdown, the clip and the answer timer line up across devices no
 * matter which path (Broadcast, postgres_changes, polling) delivered it.
 */
function beginRound(roundIndex: number, startAtHost?: number | null) {
  const state = useGameStore.getState();
  if (roundIndex < 1 || roundIndex > state.totalRounds) return;
  if (state.rounds.length === 0) return;

  const round = state.rounds.find((r) => r.roundIndex === roundIndex);
  if (!round) return;

  const timing = resolveStartLocal(startAtHost);

  // Never go backwards, and never restart a round already under way. The one
  // exception: a precisely synced start may replace an unsynced fallback
  // start while the countdown is still running.
  if (roundIndex < state.currentRoundIndex) return;
  if (roundIndex === state.currentRoundIndex && state.roundState !== 'idle') {
    const upgrade =
      state.roundState === 'countdown' &&
      roundTiming.index === roundIndex &&
      !roundTiming.synced &&
      timing.synced &&
      Math.abs(timing.at - roundTiming.startAtLocal) > 150;
    if (!upgrade) return;
  }

  clearTimers();
  clearAnswerPoll();
  roundTiming = { index: roundIndex, synced: timing.synced, startAtLocal: timing.at };
  // Make sure this round's clip is buffering (no-op if preloaded) and keep the
  // next two rounds downloading in the background.
  preloadRounds(roundIndex, 3);
  // Point the clip start at the shared time now, so playback can align to it.
  roundStartRef.at = timing.at + COUNTDOWN_MS;

  const now = Date.now();
  const roundBaseMs = timing.at; // countdown begins
  const roundStartMs = roundBaseMs + COUNTDOWN_MS; // clip + answer timer begin
  const until = (targetMs: number) => Math.max(0, targetMs - now);
  const elapsed = now - roundBaseMs;

  useGameStore.setState({
    currentRoundIndex: roundIndex,
    currentRound: round,
    roundState: 'countdown',
    countdownValue: elapsed >= 2000 ? 1 : elapsed >= 1000 ? 2 : 3,
    selectedAnswer: null,
    isCorrect: null,
    responseTimeMs: 0,
    pointsAwarded: 0,
    opponentRoundCorrect: false,
    opponentRoundPoints: 0,
    myAnswered: false,
    opponentAnswered: false,
  });

  const early = earlyAnswers.get(round.id);
  if (early) {
    earlyAnswers.delete(round.id);
    applyOpponentAnswer(round.id, early.correct, early.points);
  }

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
        if (s.currentRound?.id) {
          sendAnswer(s.currentRound.id, s.playerId, '', false, 0, ROUND_DURATION_MS);
        }
        if (s.playerId && s.currentRound?.id) {
          persistAnswer(s.currentRound.id, s.playerId, '', ROUND_DURATION_MS, false, 0);
        }
        if (useGameStore.getState().opponentAnswered) {
          resolveRound();
        } else if (s.currentRound?.id) {
          pollForOpponentAnswer(s.currentRound.id);
        }
      }
      // Measured from when this callback runs, not from beginRound's `now`
      // (that made the safety timeout fire a full countdown late).
    }, Math.max(0, roundStartMs + ROUND_DURATION_MS + 500 - Date.now()));
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

  // The cover is revealed now; make sure it has actually loaded before the
  // match moves on. (Usually instant — it was prefetched rounds ago.)
  const roundIndex = round.roundIndex;
  const coverReady = preloadCover(round.track?.album_art_url).then(() => {});
  if (!state.isHost) {
    coverReady.then(() =>
      gameChannel?.send({
        type: 'broadcast',
        event: 'cover-ready',
        payload: { roundIndex },
      })
    );
  }

  // Auto-advance once the result has been up for RESULT_MS and the covers
  // are showing (capped, so a broken image can never stall the match).
  later(async () => {
    const s = useGameStore.getState();
    const isLast = s.currentRoundIndex >= s.totalRounds;
    const waits: Promise<void>[] = [coverReady];
    if (s.isHost && !isLast) waits.push(guestCoverSignal(roundIndex).promise);
    await Promise.race([Promise.all(waits), sleep(COVER_WAIT_MAX_MS)]);

    const now = useGameStore.getState();
    // Bail if the match was reset or already moved on while we waited.
    if (now.gameOver || now.currentRoundIndex !== roundIndex || now.roundState !== 'result') {
      return;
    }
    guestCoverReady.delete(roundIndex);
    if (isLast) {
      finalizeMatch();
    } else if (now.isHost) {
      // Never start the next round for an opponent who isn't there: hold
      // here while they reconnect (resolves only if they come back).
      await waitForOpponent();
      const after = useGameStore.getState();
      if (after.gameOver || after.currentRoundIndex !== roundIndex || after.roundState !== 'result') {
        return;
      }
      advanceRoomRound();
    }
    // Guest waits for the host's 'round' broadcast (or the DB fallback).
  }, RESULT_MS);
}

async function advanceRoomRound() {
  const state = useGameStore.getState();
  const current = state.currentRoundIndex;
  const next = current + 1;
  // Announce + start immediately on both phones; the DB write below is for
  // persistence and the fallback path, and carries the same start time.
  const startAtHost = Date.now() + ROUND_LEAD_MS;
  startRoundAsHost(next, startAtHost);

  const { error } = await supabase!
    .from('rooms')
    .update({
      current_round: next,
      round_started_at: new Date(startAtHost).toISOString(),
    })
    .eq('id', state.roomId)
    .eq('current_round', current); // guard against double advance
  if (error) {
    console.warn('[game] advance failed', error.message);
    // Offline: the guest may have missed the broadcast too. Retry the save on
    // reconnect so the DB/polling path can still carry the round.
    queueWrite(async () => {
      const { error: retryErr } = await supabase!
        .from('rooms')
        .update({ current_round: next, round_started_at: new Date(startAtHost).toISOString() })
        .eq('id', state.roomId)
        .eq('current_round', current);
      return !retryErr;
    });
  }
}

async function finalizeMatch() {
  const state = useGameStore.getState();

  // Any answer that failed to save while offline must land first.
  await flushPendingWrites();

  // finalize_match (supabase/security.sql) totals both players from the
  // server-graded answers, writes match_results and completes the room.
  const { data: final, error: finalErr } = await supabase!.rpc('finalize_match', {
    p_room: state.roomId,
  });
  if (!finalErr && Array.isArray(final)) {
    const rows = final as Array<{
      player_id: string;
      total_score: number;
      correct_count: number;
      outcome: string | null;
      /** Present once supabase/elo.sql has been run. */
      rating?: number | null;
      rating_change?: number | null;
    }>;
    // The results screen keeps the scores this phone showed during the match.
    // The server's totals can briefly lag (the other phone's last answer may
    // still be on its way), which made scores jump right after the match.
    // finalize_match still records the match; whichever phone calls it last
    // saves the complete totals for the leaderboard.
    const mine = rows.find((r) => r.player_id === state.playerId);
    const theirs = rows.find((r) => r.player_id !== state.playerId);
    useGameStore.setState({
      opponentId: theirs?.player_id ?? state.opponentId,
      myRating: mine?.rating ?? null,
      myRatingChange: mine?.rating_change ?? null,
      gameOver: true,
    });
    return;
  }
  if (finalErr && finalErr.code !== 'PGRST202') {
    // Server refused (e.g. not a player): show what we have locally.
    console.warn('[game] finalize failed', finalErr.message);
    useGameStore.setState({ gameOver: true });
    return;
  }

  // Legacy path, only until security.sql has been run.
  const room = await fetchRoom(state.roomId);
  if (room) {
    // The host's opponentId was captured before the guest joined (null);
    // the room row at match end always has both players.
    const opponentId: string | null =
      (state.isHost ? room.guest_id : room.host_id) ?? state.opponentId;
    if (opponentId !== state.opponentId) useGameStore.setState({ opponentId });
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
      if (opponentId) {
        await supabase!.from('match_results').upsert(
          {
            room_id: state.roomId,
            player_id: opponentId,
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
