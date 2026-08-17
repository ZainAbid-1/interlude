import { supabase } from '../lib/supabase';
import type { RoomPoolTrack } from './rooms';

export interface RoundRecord {
  id: string;
  room_id: string;
  round_index: number;
  track_pool_track_id: string;
  options: string[];
  correct_answer: string;
}

export interface RoundAnswerRow {
  id: string;
  round_id: string;
  player_id: string | null;
  choice: string;
  response_ms: number | null;
  is_correct: boolean | null;
  points_awarded: number;
}

/**
 * Generates 10 rounds from a pool. Each round targets one pool track
 * (shuffled order so it's not 1..10). Distractors are DEALT from the artist's
 * wider catalog (`optionNames`), never reusing a song already shown in an
 * earlier round — so the answer grid is a fresh set every time instead of
 * "guess which of the same few songs". Each option set is shuffled so the
 * correct answer isn't always first.
 */
function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function buildRounds(
  poolTracks: RoomPoolTrack[],
  optionNames: string[] = []
): Array<{
  track_pool_track_id: string;
  options: string[];
  correct_answer: string;
}> {
  // Catalog names are cleaned up front: drop blanks, duplicates, and any name
  // that's already one of the 10 featured tracks (those must never be a
  // distractor, or they'd give the correct answers away).
  const poolNames = new Set(poolTracks.map((t) => t.track_name));

  const seen = new Set<string>();
  const catalogNames: string[] = [];
  for (const n of optionNames) {
    const name = (n ?? '').trim();
    if (!name || poolNames.has(name) || seen.has(name)) continue;
    seen.add(name);
    catalogNames.push(name);
  }
  const catalogDeck = shuffle(catalogNames);

  // Fallback deck: the featured pool songs, reused only after the wider catalog
  // has been fully dealt out (or on older pools without stored options).
  const poolDeckNames = [...poolNames];
  let poolDeck = shuffle(poolDeckNames);

  // Draws a raw name from whichever deck still has cards. The catalog deck is
  // dealt ONCE per game — a catalog song never repeats across rounds, so an
  // option shown in round 3 cannot show up again in round 8.
  const draw = (): string | null => {
    if (catalogDeck.length > 0) return catalogDeck.shift()!;
    if (poolDeck.length === 0) {
      poolDeck = shuffle(poolDeckNames);
    }
    return poolDeck.shift() ?? null;
  };

  const buildDistractors = (targetName: string): string[] => {
    const out: string[] = [];

    // Draw 3 names, skipping the target (only reachable from the pool fallback,
    // the catalog deck never contains pool names).
    while (out.length < 3) {
      const name = draw();
      if (name == null) break;
      if (name !== targetName && !out.includes(name)) out.push(name);
    }

    return out;
  };

  return poolTracks
    .map((track) => {
      const distractors = buildDistractors(track.track_name);
      return {
        track_pool_track_id: track.id,
        options: shuffle([track.track_name, ...distractors]),
        correct_answer: track.track_name,
      };
    })
    .sort(() => Math.random() - 0.5);
}

/** Inserts the generated rounds for a room into the `rounds` table. */
export async function generateRoundsForRoom(
  roomId: string,
  poolTracks: RoomPoolTrack[],
  optionNames: string[] = []
): Promise<{ ok: boolean; error?: string }> {
  if (!supabase) return { ok: false, error: 'Supabase is not configured' };

  const rounds = buildRounds(poolTracks, optionNames);
  const rows = rounds.map((r, i) => ({
    room_id: roomId,
    round_index: i + 1,
    track_pool_track_id: r.track_pool_track_id,
    options: r.options,
    correct_answer: r.correct_answer,
  }));

  const { error } = await supabase.from('rounds').insert(rows);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

/** Loads all rounds for a room, ordered by round_index. */
export async function fetchRoundsForRoom(
  roomId: string
): Promise<RoundRecord[] | null> {
  if (!supabase) return null;

  const { data, error } = await supabase
    .from('rounds')
    .select('*')
    .eq('room_id', roomId)
    .order('round_index', { ascending: true });
  if (error || !data) return null;
  return data as RoundRecord[];
}

/** Submits the current player's answer for a round. */
export async function submitRoundAnswer(
  roundId: string,
  playerId: string,
  choice: string,
  responseMs: number,
  isCorrect: boolean,
  pointsAwarded: number
): Promise<{ ok: boolean; error?: string }> {
  if (!supabase) return { ok: false, error: 'Supabase is not configured' };

  const { error } = await supabase.from('round_answers').insert({
    round_id: roundId,
    player_id: playerId,
    choice,
    response_ms: Math.round(responseMs),
    is_correct: isCorrect,
    points_awarded: pointsAwarded,
  });
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

/** Loads answers for a round (used to seed answered state on (re)connect). */
export async function fetchRoundAnswers(
  roundId: string
): Promise<RoundAnswerRow[]> {
  if (!supabase) return [];
  const { data } = await supabase
    .from('round_answers')
    .select('*')
    .eq('round_id', roundId);
  return (data ?? []) as RoundAnswerRow[];
}
