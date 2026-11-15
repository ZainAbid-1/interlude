/// <reference path="../nativewind-env.d.ts" />
import '../global.css';
import React, { useEffect } from 'react';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { View } from 'react-native';
import {
  useFonts,
  Inter_400Regular,
  Inter_700Bold,
} from '@expo-google-fonts/inter';
import { PlayfairDisplay_700Bold } from '@expo-google-fonts/playfair-display';
import { BebasNeue_400Regular } from '@expo-google-fonts/bebas-neue';
import { Antonio_700Bold } from '@expo-google-fonts/antonio';
import { LeagueGothic_400Regular } from '@expo-google-fonts/league-gothic';
import * as SplashScreen from 'expo-splash-screen';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { Colors } from '../constants/theme';
import { useAuthStore } from '../store/authStore';
import { useInviteStore } from '../store/inviteStore';
import { GameInviteBanner } from '../components/GameInviteBanner';

// Keep splash visible until fonts load
SplashScreen.preventAutoHideAsync().catch(() => {});

export default function RootLayout() {
  const [fontsLoaded] = useFonts({
    Inter: Inter_400Regular,
    'Inter-Bold': Inter_700Bold,
    PlayfairDisplay: PlayfairDisplay_700Bold,
    BebasNeue: BebasNeue_400Regular,
    Antonio: Antonio_700Bold,
    LeagueGothic: LeagueGothic_400Regular,
  });

  // Restore Supabase auth session + subscribe to changes
  const hydrate = useAuthStore((s) => s.hydrate);
  useEffect(() => {
    const unsubscribe = hydrate();
    return unsubscribe;
  }, [hydrate]);

  // Listen for friend challenges while signed in, on any screen.
  const userId = useAuthStore((s) => s.session?.user?.id);
  useEffect(() => {
    if (!userId) return;
    useInviteStore.getState().start(userId);
    return () => useInviteStore.getState().stop();
  }, [userId]);

  useEffect(() => {
    if (fontsLoaded) {
      SplashScreen.hideAsync().catch(() => {});
    }
  }, [fontsLoaded]);

  if (!fontsLoaded) {
    return <View style={{ flex: 1, backgroundColor: Colors.background }} />;
  }

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <StatusBar style="light" />
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: Colors.background },
          animation: 'slide_from_right',
        }}
      >
        <Stack.Screen name="index" />
        <Stack.Screen name="login" />
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="username" options={{ gestureEnabled: false }} />
        <Stack.Screen name="friend/[id]" />
        <Stack.Screen
          name="game"
          options={{
            animation: 'slide_from_bottom',
            gestureEnabled: false,
          }}
        />
        <Stack.Screen
          name="results"
          options={{
            animation: 'slide_from_bottom',
            gestureEnabled: false,
          }}
        />
      </Stack>
      <GameInviteBanner />
    </GestureHandlerRootView>
  );
}
