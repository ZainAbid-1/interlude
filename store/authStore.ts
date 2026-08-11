import { create } from 'zustand';
import type { Session, User } from '@supabase/supabase-js';
import * as WebBrowser from 'expo-web-browser';
import * as AuthSession from 'expo-auth-session';
import * as QueryParams from 'expo-auth-session/build/QueryParams';
import { Platform } from 'react-native';
import { supabase } from '../lib/supabase';

export interface UserProfile {
  id: string;
  display_name: string | null;
  avatar_url: string | null;
}

interface AuthState {
  session: Session | null;
  profile: UserProfile | null;
  loading: boolean;
  hydrate: () => () => void;
  signInWithGoogle: () => Promise<{ error: string | null }>;
  signOut: () => Promise<void>;
}

/** Upserts the profile row for a signed-in user from their auth metadata. */
async function ensureProfile(user: User | null | undefined): Promise<UserProfile | null> {
  if (!supabase || !user) return null;

  const meta = user.user_metadata ?? {};
  const upsert: UserProfile = {
    id: user.id,
    display_name: meta.full_name ?? meta.name ?? user.email ?? null,
    avatar_url: meta.avatar_url ?? meta.picture ?? null,
  };

  await supabase.from('profiles').upsert(upsert, { onConflict: 'id' });
  const { data } = await supabase
    .from('profiles')
    .select('id, display_name, avatar_url')
    .eq('id', user.id)
    .single();

  return data ?? upsert;
}

export const useAuthStore = create<AuthState>((set) => ({
  session: null,
  profile: null,
  loading: true,

  hydrate: () => {
    if (!supabase) {
      set({ loading: false });
      return () => {};
    }

    supabase.auth.getSession().then(({ data }) => {
      set({ session: data.session, loading: false });
      if (data.session?.user) {
        ensureProfile(data.session.user).then((p) => set({ profile: p ?? null }));
      }
    });

    const { data } = supabase.auth.onAuthStateChange(
      (event, session) => {
        set({ session, loading: false });
        if (event === 'SIGNED_IN') {
          ensureProfile(session?.user).then((p) => set({ profile: p ?? null }));
        }
        if (event === 'SIGNED_OUT') {
          set({ profile: null });
        }
      }
    );

    return () => {
      data.subscription.unsubscribe();
    };
  },

  signInWithGoogle: async () => {
    if (!supabase) return { error: 'Supabase is not configured' };

    try {
      // ── WEB ──────────────────────────────────────────────────────────────────
      // On web, let Supabase drive the full redirect flow.
      // openAuthSessionAsync is native-only; using it on web breaks the OAuth
      // state cookie because the page navigates away and back, losing the cookie.
      if (Platform.OS === 'web') {
        const { error } = await supabase.auth.signInWithOAuth({
          provider: 'google',
          options: {
            // Redirect back to the /callback route in the running dev server
            redirectTo: window.location.origin + '/callback',
          },
        });
        // signInWithOAuth on web automatically navigates the browser; no return value needed.
        if (error) return { error: error.message };
        return { error: null };
      }

      // ── NATIVE (Expo Go / dev build) ──────────────────────────────────────
      // Do NOT pass { scheme } here — in Expo Go the scheme is exp://, not interlude://.
      // makeRedirectUri() without a scheme override will generate the correct exp:// URL.
      WebBrowser.maybeCompleteAuthSession();
      const redirectTo = AuthSession.makeRedirectUri({ path: 'callback' });
      console.log('Redirect URI (Add this to Supabase URL Configuration):', redirectTo);

      const { data, error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo },
      });
      if (error) return { error: error.message };
      if (!data?.url) return { error: 'Could not start Google sign in' };

      const res = await WebBrowser.openAuthSessionAsync(data.url, redirectTo);
      if (res.type !== 'success') {
        return { error: 'Sign in was cancelled' };
      }

      // Parse tokens from redirect URL (may be in query params or hash fragment)
      let params: Record<string, string> = {};
      try {
        const parsed = QueryParams.getQueryParams(res.url);
        params = parsed.params || {};
        if (res.url.includes('#')) {
          const hashParams = new URLSearchParams(res.url.split('#')[1]);
          if (hashParams.has('access_token')) params.access_token = hashParams.get('access_token') as string;
          if (hashParams.has('refresh_token')) params.refresh_token = hashParams.get('refresh_token') as string;
        }
      } catch (e) {
        console.warn('Failed to parse URL', e);
      }

      const accessToken = params?.access_token;
      const refreshToken = params?.refresh_token;
      if (accessToken && refreshToken) {
        const { error: sessionError } = await supabase.auth.setSession({
          access_token: accessToken,
          refresh_token: refreshToken,
        });
        if (sessionError) return { error: sessionError.message };
      }
      return { error: null };
    } catch (e) {
      return { error: (e as Error)?.message ?? 'Sign in failed' };
    }
  },

  signOut: async () => {
    set({ profile: null, session: null });
    await supabase?.auth.signOut();
  },
}));