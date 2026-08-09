import React from 'react';
import { View, ActivityIndicator, StyleSheet } from 'react-native';
import { Redirect } from 'expo-router';
import { useAuthStore } from '../store/authStore';
import { AlbumCollageBackground } from '../components/AlbumCollageBackground';
import LoginScreen from './login';

export default function EntryScreen() {
  const session = useAuthStore((s) => s.session);
  const isGuest = useAuthStore((s) => s.isGuest);
  const loading = useAuthStore((s) => s.loading);

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <AlbumCollageBackground />
        <ActivityIndicator size="large" color="#ffc98a" style={{ zIndex: 10 }} />
      </View>
    );
  }

  if (session || isGuest) {
    return <Redirect href="/(tabs)" />;
  }

  return <LoginScreen />;
}

const styles = StyleSheet.create({
  loadingContainer: {
    flex: 1,
    backgroundColor: '#0a0a0a',
    justifyContent: 'center',
    alignItems: 'center',
  },
});
