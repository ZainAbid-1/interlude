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
 * (shuffled order so it's not 1..10), with 3 other pool tracks as distractors.
 * Options are shuffled so the correct answer isn't always first.
 */
export function buildRounds(
  poolTracks: RoomPoolTrack[]
): Array<{
  track_pool_track_id: string;
  options: string[];
  correct_answer: string;
}> {
  const order = [...poolTracks].sort(() => Math.random() - 0.5);
  const target = order[0];

  return poolTracks.map((track) => {
    const distractors = poolTracks
      .filter((t) => t.id !== track.id)
      .sort(() => Math.random() - 0.5)
      .slice(0, 3)
      .map((t) => t.track_name);

    return {
      track_pool_track_id: track.id,
      options: [track.track_name, ...distractors].sort(
        () => Math.random() - 0.5
      ),
      correct_answer: track.track_name,
    };
  }).sort(() => Math.random() - 0.5);
}

/** Inserts the generated rounds for a room into the `rounds` table. */
export async function generateRoundsForRoom(
  roomId: string,
  poolTracks: RoomPoolTrack[]
): Promise<{ ok: boolean; error?: string }> {
  if (!supabase) return { ok: false, error: 'Supabase is not configured' };

  const rounds = buildRounds(poolTracks);
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
