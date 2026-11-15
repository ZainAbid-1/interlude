import { rpc, Result } from './friends';

/**
 * Challenge-a-friend invites + head-to-head history. Wrappers over the
 * functions in supabase/invites.sql.
 */

export interface GameInvite {
  id: string;
  room_id: string;
  created_at: string;
  expires_at: string;
  from_id: string;
  from_username: string | null;
  from_display_name: string | null;
  from_avatar_url: string | null;
  artist_name: string;
  artist_image_url: string | null;
}

export interface H2HMatch {
  room_id: string;
  played_at: string;
  artist_name: string;
  artist_image_url: string | null;
  my_score: number;
  their_score: number | null;
  my_correct: number;
  their_correct: number | null;
  outcome: 'win' | 'loss' | 'draw' | null;
}

export function sendGameInvite(toUserId: string, roomId: string) {
  return rpc<string>('send_game_invite', { p_to: toUserId, p_room: roomId });
}

/** Accept → the room code to join; decline → null. */
export function respondGameInvite(inviteId: string, accept: boolean) {
  return rpc<string | null>('respond_game_invite', { p_invite: inviteId, p_accept: accept });
}

/** Withdraw pending invites for a room (or all of mine). */
export function cancelGameInvites(roomId?: string) {
  return rpc<null>('cancel_game_invite', { p_room: roomId ?? null });
}

export async function listGameInvites(): Promise<Result<GameInvite[]>> {
  const res = await rpc<GameInvite[]>('list_game_invites');
  return res.error ? res : { data: res.data ?? [] };
}

export async function headToHead(userId: string): Promise<Result<H2HMatch[]>> {
  const res = await rpc<H2HMatch[]>('head_to_head', { p_user: userId });
  return res.error ? res : { data: res.data ?? [] };
}

// ─── Head-to-head summary ───────────────────────────────────────────────

export interface ArtistBattle {
  artist: string;
  image: string | null;
  played: number;
  wins: number;
  losses: number;
  draws: number;
}

export interface H2HSummary {
  played: number;
  wins: number;
  losses: number;
  draws: number;
  /** Current streak from the newest match: who's on it and how long. */
  streak: { who: 'me' | 'them' | 'draw'; count: number } | null;
  /** Artists played together, most played first. */
  artists: ArtistBattle[];
  biggestWin: H2HMatch | null;
  biggestLoss: H2HMatch | null;
  closest: H2HMatch | null;
  /** Artist where I have the most wins over them (and vice versa). */
  myBestArtist: ArtistBattle | null;
  theirBestArtist: ArtistBattle | null;
  totalCorrect: { me: number; them: number };
  lastPlayed: string | null;
}

const margin = (m: H2HMatch) => m.my_score - (m.their_score ?? 0);

export function summarizeHeadToHead(matches: H2HMatch[]): H2HSummary {
  // Newest first (as returned by head_to_head).
  const sorted = [...matches].sort((a, b) => b.played_at.localeCompare(a.played_at));
  const wins = sorted.filter((m) => m.outcome === 'win').length;
  const losses = sorted.filter((m) => m.outcome === 'loss').length;
  const draws = sorted.filter((m) => m.outcome === 'draw').length;

  let streak: H2HSummary['streak'] = null;
  if (sorted.length && sorted[0].outcome) {
    const first = sorted[0].outcome;
    let count = 0;
    for (const m of sorted) {
      if (m.outcome !== first) break;
      count++;
    }
    streak = { who: first === 'win' ? 'me' : first === 'loss' ? 'them' : 'draw', count };
  }

  const byArtist = new Map<string, ArtistBattle>();
  for (const m of sorted) {
    const key = m.artist_name.toLowerCase();
    const a = byArtist.get(key) ?? {
      artist: m.artist_name,
      image: m.artist_image_url,
      played: 0,
      wins: 0,
      losses: 0,
      draws: 0,
    };
    a.played++;
    if (m.outcome === 'win') a.wins++;
    else if (m.outcome === 'loss') a.losses++;
    else if (m.outcome === 'draw') a.draws++;
    if (!a.image && m.artist_image_url) a.image = m.artist_image_url;
    byArtist.set(key, a);
  }
  const artists = [...byArtist.values()].sort((a, b) => b.played - a.played || b.wins - a.wins);

  const won = sorted.filter((m) => m.outcome === 'win');
  const lost = sorted.filter((m) => m.outcome === 'loss');
  const biggestWin = won.reduce<H2HMatch | null>((best, m) => (!best || margin(m) > margin(best) ? m : best), null);
  const biggestLoss = lost.reduce<H2HMatch | null>((worst, m) => (!worst || margin(m) < margin(worst) ? m : worst), null);
  const closest = sorted
    .filter((m) => m.their_score != null)
    .reduce<H2HMatch | null>((c, m) => (!c || Math.abs(margin(m)) < Math.abs(margin(c)) ? m : c), null);

  const myBestArtist =
    artists.filter((a) => a.wins > 0).sort((a, b) => b.wins - a.wins || a.losses - b.losses)[0] ?? null;
  const theirBestArtist =
    artists.filter((a) => a.losses > 0).sort((a, b) => b.losses - a.losses || a.wins - b.wins)[0] ?? null;

  return {
    played: sorted.length,
    wins,
    losses,
    draws,
    streak,
    artists,
    biggestWin,
    biggestLoss,
    closest,
    myBestArtist,
    theirBestArtist,
    totalCorrect: {
      me: sorted.reduce((n, m) => n + (m.my_correct ?? 0), 0),
      them: sorted.reduce((n, m) => n + (m.their_correct ?? 0), 0),
    },
    lastPlayed: sorted[0]?.played_at ?? null,
  };
}
