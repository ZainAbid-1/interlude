import { rpc, Result } from './friends';

/**
 * Leaderboard reads. Thin wrappers over the SECURITY DEFINER functions in
 * supabase/leaderboard.sql, which return ranked totals only (never single
 * matches or rooms).
 */

export type Scope = 'friends' | 'global';
export type Period = 'week' | 'all';

export interface LeaderboardArtist {
  artist_key: string;
  artist_name: string;
  artist_image_url: string | null;
  /** Finished matches with this artist (everyone, in the period). */
  matches: number;
  my_matches: number;
  my_best: number | null;
}

export interface LeaderboardRow {
  rank: number;
  player_id: string;
  username: string | null;
  display_name: string | null;
  avatar_url: string | null;
  /** Artist board: best single-match score. All artists: Elo rating. */
  score: number;
  correct: number;
  avg_ms: number | null;
  matches: number;
  wins: number;
  is_me: boolean;
  is_friend: boolean;
  /** Players on this board in total. */
  total: number;
  /** All artists only: rating gained in the last 7 days (null on artist boards). */
  rating_change?: number | null;
  /** All artists only: fewer than 5 rated matches, so the rating is still settling. */
  provisional?: boolean;
}

/** Artists for the picker; pass a query to search any played artist. */
export function listLeaderboardArtists(
  period: Period,
  query?: string
): Promise<Result<LeaderboardArtist[]>> {
  return rpc<LeaderboardArtist[]>('leaderboard_artists', {
    p_period: period,
    p_query: query?.trim() || null,
  });
}

/** One board. artistKey null = "All artists" (ranked by wins). */
export function getLeaderboard(
  artistKey: string | null,
  scope: Scope,
  period: Period
): Promise<Result<LeaderboardRow[]>> {
  return rpc<LeaderboardRow[]>('artist_leaderboard', {
    p_artist: artistKey,
    p_scope: scope,
    p_period: period,
  });
}
