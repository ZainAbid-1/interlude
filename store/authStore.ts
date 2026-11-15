import { create } from 'zustand';
import type { Session, User } from '@supabase/supabase-js';
import * as WebBrowser from 'expo-web-browser';
import * as AuthSession from 'expo-auth-session';
import * as QueryParams from 'expo-auth-session/build/QueryParams';
import { Platform } from 'react-native';
import { supabase } from '../lib/supabase';
import { normalizeUsername, setUsername as setUsernameRpc } from '../services/friends';

export interface UserProfile {
  id: string;
  display_name: string | null;
  avatar_url: string | null;
  /** null = not picked yet; undefined = server not set up (friends.sql). */
  username?: string | null;
}

interface AuthState {
  session: Session | null;
  profile: UserProfile | null;
  loading: boolean;
  hydrate: () => () => void;
  signInWithGoogle: () => Promise<{ error: string | null }>;
  signOut: () => Promise<void>;
  /** Sets (or changes) the username and updates the profile in place. */
  saveUsername: (username: string) => Promise<{ error: string | null }>;
}

/** Upserts the profile row for a signed-in user from their auth metadata. */
async function ensureProfile(user: User | null | undefined): Promise<UserProfile | null> {
  if (!supabase || !user) return null;

  const meta = user.user_metadata ?? {};
  const upsert: UserProfile = {
    id: user.id,
    // Never the email: other players can see display names in search.
    display_name: meta.full_name ?? meta.name ?? null,
    avatar_url: meta.avatar_url ?? meta.picture ?? null,
  };

  await supabase.from('profiles').upsert(upsert, { onConflict: 'id' });
  const withUsername = await supabase
    .from('profiles')
    .select('id, display_name, avatar_url, username')
    .eq('id', user.id)
    .single();
  if (!withUsername.error && withUsername.data) return withUsername.data as UserProfile;

  // The username column only exists once supabase/friends.sql has been run.
  const basic = await supabase
    .from('profiles')
    .select('id, display_name, avatar_url')
    .eq('id', user.id)
    .single();
  return (basic.data as UserProfile | null) ?? upsert;
}

export const useAuthStore = create<AuthState>((set, get) => ({
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

  saveUsername: async (username) => {
    const clean = normalizeUsername(username);
    const res = await setUsernameRpc(clean);
    if (res.error) return { error: res.error };
    const profile = get().profile;
    if (profile) set({ profile: { ...profile, username: clean } });
    return { error: null };
  },
}));