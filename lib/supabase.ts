import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';
import { Platform } from 'react-native';

const SUPABASE_URL = (process.env.EXPO_PUBLIC_SUPABASE_URL ?? '').trim();
const SUPABASE_ANON_KEY = (process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '').trim();

type HeartbeatListener = (status: string) => void;
const heartbeatListeners = new Set<HeartbeatListener>();

/**
 * Subscribe to the Realtime socket's heartbeat results ('ok', 'timeout',
 * 'disconnected', ...). A 'timeout' is usually the first sign this phone
 * lost its network, since a dead WebSocket rarely reports a close.
 */
export function onRealtimeHeartbeat(listener: HeartbeatListener): () => void {
  heartbeatListeners.add(listener);
  return () => {
    heartbeatListeners.delete(listener);
  };
}

/** Quick reconnect backoff for a live game (defaults go up to 10s). */
const RECONNECT_STEPS_MS = [500, 1000, 2000];

/**
 * Supabase client. Null until EXPO_PUBLIC_SUPABASE_URL and
 * EXPO_PUBLIC_SUPABASE_ANON_KEY are configured so the app stays
 * usable in development without a Supabase project.
 */
export const supabase =
  SUPABASE_URL && SUPABASE_ANON_KEY
    ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
        auth: {
          storage: AsyncStorage as any,
          autoRefreshToken: true,
          persistSession: true,
          // On web: detect OAuth tokens from the URL hash after redirect.
          // On native: keep false — Expo's Metro bundler URL should not be parsed.
          detectSessionInUrl: Platform.OS === 'web',
        },
        realtime: {
          // Default is 25s, so a phone that lost its network kept believing
          // it was connected for up to ~50s. 5s notices a dead socket fast.
          heartbeatIntervalMs: 5000,
          timeout: 5000,
          reconnectAfterMs: (tries: number) => RECONNECT_STEPS_MS[tries - 1] ?? 3000,
          heartbeatCallback: (status: string) => {
            heartbeatListeners.forEach((listener) => listener(status));
          },
        },
      })
    : null;

export const isSupabaseConfigured = supabase !== null;
