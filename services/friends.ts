import { supabase } from '../lib/supabase';

/**
 * Usernames + friends. Thin wrappers over the SECURITY DEFINER functions in
 * supabase/friends.sql: profiles stay private, and these return only the
 * public fields (username, display name, avatar) plus your relationship.
 */

export type Relation = 'friend' | 'outgoing' | 'incoming' | 'none';

export interface Player {
  id: string;
  username: string;
  display_name: string | null;
  avatar_url: string | null;
  relation: Relation;
}

export interface Friend extends Player {
  wins: number;
  losses: number;
  draws: number;
  created_at: string;
}

export type Result<T> = { data: T; error?: undefined } | { data?: undefined; error: string };

export const USERNAME_PATTERN = /^[a-z0-9_.]{3,20}$/;

const NOT_SET_UP =
  "This feature isn't set up on the server yet. Run the supabase/*.sql migrations in the Supabase SQL editor.";

function toMessage(error: { code?: string; message?: string } | null | undefined): string {
  if (!error) return 'Something went wrong';
  // PGRST202 = function not found → the migration hasn't been run.
  if (error.code === 'PGRST202' || /could not find the function/i.test(error.message ?? '')) {
    return NOT_SET_UP;
  }
  return error.message || 'Something went wrong';
}

export async function rpc<T>(fn: string, args?: Record<string, unknown>): Promise<Result<T>> {
  if (!supabase) return { error: 'Supabase is not configured' };
  try {
    const { data, error } = await supabase.rpc(fn, args);
    if (error) return { error: toMessage(error) };
    return { data: data as T };
  } catch (e) {
    return { error: (e as Error)?.message ?? 'Network error' };
  }
}

/** Lowercases and strips anything a username can't contain. */
export function normalizeUsername(input: string): string {
  return input.trim().replace(/^@+/, '').toLowerCase().replace(/[^a-z0-9_.]/g, '');
}

/** A starting suggestion from the player's Google name, e.g. "zain_abid". */
export function suggestUsername(displayName: string | null | undefined): string {
  const base = (displayName ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 16);
  return base.length >= 3 ? base : `player_${Math.floor(1000 + Math.random() * 9000)}`;
}

export function isUsernameAvailable(username: string) {
  return rpc<boolean>('is_username_available', { p_username: username });
}

export function setUsername(username: string) {
  return rpc<null>('set_username', { p_username: username });
}

export async function searchPlayers(query: string): Promise<Result<Player[]>> {
  const q = query.trim().replace(/^@+/, '');
  if (q.length < 2) return { data: [] };
  const res = await rpc<Player[]>('search_players', { p_query: q });
  return res.error ? res : { data: res.data ?? [] };
}

export async function listFriends(): Promise<Result<Friend[]>> {
  const res = await rpc<Friend[]>('list_friends');
  return res.error ? res : { data: res.data ?? [] };
}

export function sendFriendRequest(userId: string) {
  return rpc<Relation>('send_friend_request', { p_user: userId });
}

export function respondFriendRequest(userId: string, accept: boolean) {
  return rpc<Relation>('respond_friend_request', { p_user: userId, p_accept: accept });
}

/** Unfriend, or cancel a request you sent. */
export function removeFriend(userId: string) {
  return rpc<Relation>('remove_friend', { p_user: userId });
}
