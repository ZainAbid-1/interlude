import { create } from 'zustand';
import { AppState } from 'react-native';
import type { NativeEventSubscription } from 'react-native';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import {
  GameInvite,
  cancelGameInvites,
  listGameInvites,
  respondGameInvite,
  sendGameInvite,
} from '../services/invites';

export type OutgoingStatus = 'pending' | 'accepted' | 'declined' | 'cancelled' | 'expired' | 'error';

export interface OutgoingInvite {
  inviteId: string;
  roomId: string;
  toId: string;
  toName: string;
  status: OutgoingStatus;
  expiresAt: number;
}

interface InviteState {
  /** Open challenges sent to me (newest first). */
  incoming: GameInvite[];
  /** The challenge I'm waiting on in my lobby. */
  outgoing: OutgoingInvite | null;

  start: (userId: string) => void;
  stop: () => void;
  refreshIncoming: () => Promise<void>;
  invite: (friend: { id: string; name: string }, roomId: string) => Promise<{ error?: string }>;
  /** Accept → { code } to join; decline → {}. */
  respond: (invite: GameInvite, accept: boolean) => Promise<{ code?: string | null; error?: string }>;
  cancelOutgoing: () => void;
}

/** Invites expire server-side after 2 minutes; mirror that locally. */
const OUTGOING_TTL_MS = 2 * 60 * 1000;

let channel: RealtimeChannel | null = null;
let appStateSub: NativeEventSubscription | null = null;
let currentUser: string | null = null;
let outgoingTimer: ReturnType<typeof setTimeout> | null = null;
let incomingTimer: ReturnType<typeof setTimeout> | null = null;

export const useInviteStore = create<InviteState>((set, get) => ({
  incoming: [],
  outgoing: null,

  start: (userId) => {
    if (!supabase || currentUser === userId) return;
    get().stop();
    currentUser = userId;

    channel = supabase
      .channel(`invites:${userId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'game_invites', filter: `to_id=eq.${userId}` },
        () => get().refreshIncoming()
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'game_invites', filter: `from_id=eq.${userId}` },
        (payload) => {
          const row = payload.new as { id: string; status: OutgoingStatus };
          const out = get().outgoing;
          if (out && row.id === out.inviteId && out.status === 'pending') {
            set({ outgoing: { ...out, status: row.status } });
          }
        }
      )
      .subscribe((status) => {
        // (Re)joined: pick up anything that arrived while we weren't listening.
        if (status === 'SUBSCRIBED') get().refreshIncoming();
      });

    appStateSub = AppState.addEventListener('change', (state) => {
      if (state === 'active') get().refreshIncoming();
    });
  },

  stop: () => {
    if (channel) supabase?.removeChannel(channel);
    channel = null;
    appStateSub?.remove();
    appStateSub = null;
    currentUser = null;
    if (outgoingTimer) clearTimeout(outgoingTimer);
    if (incomingTimer) clearTimeout(incomingTimer);
    outgoingTimer = incomingTimer = null;
    set({ incoming: [], outgoing: null });
  },

  refreshIncoming: async () => {
    if (!currentUser) return;
    const res = await listGameInvites();
    if (res.error) return;
    const now = Date.now();
    const open = (res.data ?? []).filter((i) => Date.parse(i.expires_at) > now);
    set({ incoming: open });

    // Drop each invite from the list the moment it expires.
    if (incomingTimer) clearTimeout(incomingTimer);
    const next = Math.min(...open.map((i) => Date.parse(i.expires_at)));
    if (Number.isFinite(next)) {
      incomingTimer = setTimeout(() => get().refreshIncoming(), Math.max(0, next - Date.now()) + 250);
    }
  },

  invite: async (friend, roomId) => {
    const res = await sendGameInvite(friend.id, roomId);
    if (res.error || !res.data) return { error: res.error ?? 'Could not send the invite' };
    const expiresAt = Date.now() + OUTGOING_TTL_MS;
    set({
      outgoing: {
        inviteId: res.data,
        roomId,
        toId: friend.id,
        toName: friend.name,
        status: 'pending',
        expiresAt,
      },
    });
    if (outgoingTimer) clearTimeout(outgoingTimer);
    outgoingTimer = setTimeout(() => {
      const out = get().outgoing;
      if (out && out.inviteId === res.data && out.status === 'pending') {
        set({ outgoing: { ...out, status: 'expired' } });
      }
    }, OUTGOING_TTL_MS);
    return {};
  },

  respond: async (invite, accept) => {
    // Hide it right away; the server decides the outcome.
    set({ incoming: get().incoming.filter((i) => i.id !== invite.id) });
    const res = await respondGameInvite(invite.id, accept);
    if (res.error) {
      get().refreshIncoming();
      return { error: res.error };
    }
    return { code: res.data ?? null };
  },

  cancelOutgoing: () => {
    const out = get().outgoing;
    if (outgoingTimer) clearTimeout(outgoingTimer);
    outgoingTimer = null;
    set({ outgoing: null });
    if (out && out.status === 'pending') cancelGameInvites(out.roomId);
  },
}));
