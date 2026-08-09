import { create } from 'zustand';
import type { Session, User } from '@supabase/supabase-js';
import * as WebBrowser from 'expo-web-browser';
import * as AuthSession from 'expo-auth-session';
import * as QueryParams from 'expo-auth-session/build/QueryParams';
import { supabase } from '../lib/supabase';

export interface UserProfile {
  id: string;
  display_name: string | null;
  avatar_url: string | null;
}

interface AuthState {
  session: Session | null;
  profile: UserProfile | null;
  isGuest: boolean;
  loading: boolean;
  hydrate: () => () => void;
  signInWithGoogle: () => Promise<{ error: string | null }>;
  signInAsGuest: () => void;
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
  isGuest: false,
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
        set({ session, loading: false, isGuest: false });
        if (event === 'SIGNED_IN') {
          ensureProfile(session?.user).then((p) => set({ profile: p ?? null }));
        }
        if (event === 'SIGNED_OUT') {
          set({ profile: null, isGuest: false });
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
      WebBrowser.maybeCompleteAuthSession();
      const redirectTo = AuthSession.makeRedirectUri();
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

      const { params } = QueryParams.getQueryParams(res.url);
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

  signInAsGuest: () => {
    set({
      isGuest: true,
      profile: {
        id: 'guest_' + Math.random().toString(36).substring(2, 8),
        display_name: 'Guest Player',
        avatar_url: null,
      },
    });
  },

  signOut: async () => {
    set({ isGuest: false, profile: null, session: null });
    await supabase?.auth.signOut();
  },
}));