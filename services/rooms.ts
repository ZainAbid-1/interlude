import { supabase } from '../lib/supabase';
import type { SpotifyArtist, TrackPoolItem } from './spotify';

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function generateCode(length = 6): string {
  let code = '';
  for (let i = 0; i < length; i++) {
    code += CODE_CHARS.charAt(Math.floor(Math.random() * CODE_CHARS.length));
  }
  return code;
}

export interface RoomPoolTrack {
  id: string;
  position: number;
  spotify_track_id: string;
  track_name: string;
  album_art_url: string | null;
  preview_url: string;
  preview_source: 'itunes' | 'deezer';
  clip_start_ms: number;
}

export interface RoomRecord {
  id: string;
  code: string;
  host_id: string | null;
  guest_id: string | null;
  track_pool_id: string;
  status: 'waiting' | 'active' | 'completed';
  current_round: number;
}

export interface RoomWithPool {
  room: RoomRecord;
  artist: SpotifyArtist;
  tracks: RoomPoolTrack[];
  /** Same-artist track names for answer distractors (wider catalog). */
  options: string[];
}

function toArtist(pool: any): SpotifyArtist {
  return {
    id: pool.spotify_artist_id ?? '',
    name: pool.artist_name ?? '',
    image: pool.artist_image_url ?? '',
  };
}

/**
 * Persists a generated track pool, its 10 tracks, and the artist's wider
 * catalog (option names used as answer distractors) to Supabase.
 * The "3-second clip" is stored as { preview_url, clip_start_ms } per track —
 * the client seeks to clip_start_ms and plays 3s on demand.
 */
export async function saveTrackPool(
  artist: SpotifyArtist,
  tracks: TrackPoolItem[],
  optionNames: string[] = []
): Promise<{ poolId: string } | { error: string }> {
  if (!supabase) return { error: 'Supabase is not configured' };

  const { data: user, error: userErr } = await supabase.auth.getUser();
  if (userErr || !user.user) return { error: 'You must be signed in to host a room' };

  const { data: pool, error: poolErr } = await supabase
    .from('track_pools')
    .insert({
      created_by: user.user.id,
      spotify_artist_id: artist.id,
      artist_name: artist.name,
      artist_image_url: artist.image,
    })
    .select('id')
    .single();
  if (poolErr || !pool) return { error: poolErr?.message ?? 'Failed to save track pool' };

  const rows = tracks.map((t, i) => ({
    track_pool_id: pool.id,
    position: i + 1,
    spotify_track_id: t.spotifyTrackId,
    track_name: t.trackName,
    album_art_url: t.albumArtUrl,
    preview_url: t.previewUrl,
    preview_source: t.previewSource,
    clip_start_ms: t.clipStartMs,
  }));

  const { error: tracksErr } = await supabase.from('track_pool_tracks').insert(rows);
  if (tracksErr) return { error: tracksErr.message };

  // Best-effort: rooms created against an older schema (no track_pool_options
  // table yet) still work — the round generator falls back to in-pool options.
  if (optionNames.length > 0) {
    const uniq = optionNames.filter(
      (n, i, all) => !!n && all.indexOf(n) === i
    );
    try {
      const { error: optsErr } = await supabase.from('track_pool_options').insert(
        uniq.map((name, i) => ({
          track_pool_id: pool.id,
          position: i + 1,
          track_name: name,
        }))
      );
      if (optsErr) {
        console.warn('[rooms] track_pool_options insert failed', optsErr.message);
      }
    } catch (e) {
      console.warn('[rooms] track_pool_options unavailable — using in-pool options', e);
    }
  }

  return { poolId: pool.id };
}

/**
 * Creates a room with a unique 6-char code tied to a saved pool.
 * Retries on unique-code collisions.
 */
export async function createRoom(
  poolId: string
): Promise<{ roomId: string; code: string } | { error: string }> {
  if (!supabase) return { error: 'Supabase is not configured' };

  const { data: user, error: userErr } = await supabase.auth.getUser();
  if (userErr || !user.user) return { error: 'You must be signed in to host a room' };

  for (let attempt = 0; attempt < 5; attempt++) {
    const code = generateCode();
    const { data: room, error } = await supabase
      .from('rooms')
      .insert({
        code,
        host_id: user.user.id,
        track_pool_id: poolId,
        status: 'waiting',
      })
      .select('id, code')
      .single();

    if (error) {
      // 23505 = unique_violation on rooms.code → try another code
      if (String(error.code) === '23505') continue;
      return { error: error.message };
    }
    if (room) return { roomId: room.id, code: room.code };
  }

  return { error: 'Could not generate a unique room code' };
}

/**
 * Looks up a room by code and claims it as the guest if it's still waiting.
 * Returns the room together with its pool so the client can play immediately.
 */
export async function joinRoom(
  code: string
): Promise<RoomWithPool | { error: string }> {
  if (!supabase) return { error: 'Supabase is not configured' };

  const { data: user, error: userErr } = await supabase.auth.getUser();
  if (userErr || !user.user) return { error: 'You must be signed in to join a room' };

  const normalized = code.trim().toUpperCase();
  if (!normalized) return { error: 'Enter a room code' };

  const { data: room, error: roomErr } = await supabase
    .from('rooms')
    .select('*')
    .eq('code', normalized)
    .maybeSingle();
  if (roomErr) return { error: roomErr.message };
  if (!room) return { error: 'Room not found' };
  if (room.status !== 'waiting') return { error: 'This room has already started' };
  if (room.host_id === user.user.id) return { error: 'You are the host of this room' };
  if (room.guest_id && room.guest_id !== user.user.id) {
    return { error: 'This room is already full' };
  }

  const { error: joinErr } = await supabase
    .from('rooms')
    .update({ guest_id: user.user.id })
    .eq('id', room.id);
  if (joinErr) return { error: joinErr.message };

  const poolResult = await loadPool(room.track_pool_id);
  if ('error' in poolResult) return { error: poolResult.error };

  return {
    room: room as RoomRecord,
    artist: poolResult.artist,
    tracks: poolResult.tracks,
    options: poolResult.options,
  };
}

/**
 * Fetches a pool's artist, tracks, and option-name catalog. Used by the host
 * after creation and the guest after joining. Tolerates a missing
 * `track_pool_options` table (older installs) by returning an empty list.
 */
export async function loadPool(
  poolId: string
): Promise<
  { artist: SpotifyArtist; tracks: RoomPoolTrack[]; options: string[] } | { error: string }
> {
  if (!supabase) return { error: 'Supabase is not configured' };

  const { data: pool, error: poolErr } = await supabase
    .from('track_pools')
    .select('spotify_artist_id, artist_name, artist_image_url')
    .eq('id', poolId)
    .maybeSingle();
  if (poolErr) return { error: poolErr.message };
  if (!pool) return { error: 'Track pool not found' };

  const { data: tracks, error: tracksErr } = await supabase
    .from('track_pool_tracks')
    .select('*')
    .eq('track_pool_id', poolId)
    .order('position', { ascending: true });
  if (tracksErr) return { error: tracksErr.message };

  let options: string[] = [];
  try {
    const { data: optData, error: optErr } = await supabase
      .from('track_pool_options')
      .select('track_name')
      .eq('track_pool_id', poolId)
      .order('position', { ascending: true });
    if (!optErr && optData) {
      options = (optData as { track_name: string }[]).map((o) => o.track_name);
    }
  } catch (e) {
    // older schema without track_pool_options → in-pool options only
  }

  return {
    artist: toArtist(pool),
    tracks: (tracks ?? []) as RoomPoolTrack[],
    options,
  };
}
