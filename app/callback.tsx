import React, { useEffect } from 'react';
import { View, Text, ActivityIndicator, StyleSheet, Platform } from 'react-native';
import { useRouter } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { supabase } from '../lib/supabase';

// Required for closing the popup on web when Expo WebBrowser opened a popup
WebBrowser.maybeCompleteAuthSession();

export default function CallbackScreen() {
  const router = useRouter();

  useEffect(() => {
    // On web: Supabase puts the code/tokens in the URL hash or query params.
    // The Supabase client auto-detects and exchanges the code when detectSessionInUrl is true.
    // We just need to wait for the session to be set, then redirect.
    if (Platform.OS === 'web' && supabase) {
      // Let the Supabase client auto-process the URL
      supabase.auth.getSession().then(({ data }) => {
        if (data.session) {
          router.replace('/');
        } else {
          // Give Supabase a moment to process the hash/code from the URL
          const timer = setTimeout(() => {
            router.replace('/');
          }, 1500);
          return () => clearTimeout(timer);
        }
      });
    } else {
      // On native, this route shouldn't normally be reached via the router
      // since the WebBrowser popup handles the callback. Just redirect home.
      const timer = setTimeout(() => {
        router.replace('/');
      }, 500);
      return () => clearTimeout(timer);
    }
  }, [router]);

  return (
    <View style={styles.container}>
      <ActivityIndicator size="large" color="#ffc98a" />
      <Text style={styles.text}>Completing sign in...</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#0a0a0a',
  },
  text: {
    color: '#ffffff',
    marginTop: 16,
    fontFamily: 'Inter',
    fontSize: 16,
    letterSpacing: 0.5,
  },
});
