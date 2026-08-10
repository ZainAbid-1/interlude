import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';
import { Platform } from 'react-native';

const SUPABASE_URL = (process.env.EXPO_PUBLIC_SUPABASE_URL ?? '').trim();
const SUPABASE_ANON_KEY = (process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '').trim();

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
      })
    : null;

export const isSupabaseConfigured = supabase !== null;