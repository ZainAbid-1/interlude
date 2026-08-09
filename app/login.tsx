import React, { useState } from 'react';
import {
  View,
  Text,
  Pressable,
  StyleSheet,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { useRouter } from 'expo-router';
import Animated, { FadeInDown, FadeInUp } from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import { AlbumCollageBackground } from '../components/AlbumCollageBackground';
import { useAuthStore } from '../store/authStore';
import { Colors, Spacing, BorderRadius } from '../constants/theme';

export default function LoginScreen() {
  const router = useRouter();
  const signInWithGoogle = useAuthStore((s) => s.signInWithGoogle);
  const signInAsGuest = useAuthStore((s) => s.signInAsGuest);
  const [signingIn, setSigningIn] = useState(false);

  const handleGoogleSignIn = async () => {
    setSigningIn(true);
    try {
      const { error } = await signInWithGoogle();
      setSigningIn(false);
      if (error) {
        Alert.alert(
          'Google Sign-In',
          error,
          [
            { text: 'OK' },
            {
              text: 'Continue as Guest',
              onPress: () => {
                signInAsGuest();
                router.replace('/(tabs)');
              },
            },
          ]
        );
      } else {
        router.replace('/(tabs)');
      }
    } catch (e) {
      setSigningIn(false);
      Alert.alert('Sign-in Error', (e as Error)?.message ?? 'An unexpected error occurred');
    }
  };

  const handleGuestSignIn = () => {
    signInAsGuest();
    router.replace('/(tabs)');
  };

  return (
    <View style={styles.container}>
      <AlbumCollageBackground />

      <View style={styles.content}>
        {/* Title in exact Antonio font in the middle of the screen */}
        <Animated.View entering={FadeInDown.delay(100).duration(800)} style={styles.titleContainer}>
          <Text style={styles.title}>INTERLUDE.</Text>
          <Text style={styles.subtitle}>Music Trivia & Guessing Experience</Text>
        </Animated.View>

        {/* Google sign-in link / button */}
        <Animated.View entering={FadeInUp.delay(300).duration(800)} style={styles.actionContainer}>
          <Pressable
            onPress={handleGoogleSignIn}
            disabled={signingIn}
            style={({ pressed }) => [
              styles.googleButton,
              pressed && styles.buttonPressed,
              signingIn && styles.buttonDisabled,
            ]}
          >
            {signingIn ? (
              <ActivityIndicator color="#ffffff" size="small" style={{ marginRight: 8 }} />
            ) : (
              <View style={styles.googleIconContainer}>
                <Ionicons name="logo-google" size={20} color="#ffc98a" />
              </View>
            )}
            <Text style={styles.googleButtonText}>
              {signingIn ? 'Signing in...' : 'Sign in with Google'}
            </Text>
          </Pressable>

          <Pressable onPress={handleGuestSignIn} style={styles.guestLink} hitSlop={12}>
            <Text style={styles.guestText}>Continue as Guest</Text>
            <Ionicons name="arrow-forward" size={14} color="rgba(255, 255, 255, 0.6)" />
          </Pressable>
        </Animated.View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0a0a0a',
  },
  content: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: Spacing.gutter,
    zIndex: 10,
  },
  titleContainer: {
    alignItems: 'center',
    marginBottom: 44,
  },
  title: {
    fontFamily: 'Antonio',
    fontSize: 58,
    color: '#ffffff',
    letterSpacing: 6,
    textTransform: 'uppercase',
    textAlign: 'center',
    lineHeight: 64,
    textShadowColor: 'rgba(232, 169, 92, 0.5)',
    textShadowOffset: { width: 0, height: 4 },
    textShadowRadius: 16,
  },
  subtitle: {
    fontFamily: 'Inter-Bold',
    fontSize: 13,
    color: 'rgba(255, 255, 255, 0.75)',
    letterSpacing: 1.5,
    textTransform: 'uppercase',
    marginTop: 10,
    textAlign: 'center',
    textShadowColor: 'rgba(0, 0, 0, 0.8)',
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 8,
  },
  actionContainer: {
    width: '100%',
    maxWidth: 320,
    alignItems: 'center',
    gap: 16,
  },
  googleButton: {
    width: '100%',
    height: 56,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(26, 13, 5, 0.85)',
    borderWidth: 1.5,
    borderColor: 'rgba(255, 190, 110, 0.35)',
    borderRadius: BorderRadius.full,
    paddingHorizontal: 24,
    shadowColor: '#e8a95c',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 12,
    elevation: 8,
  },
  buttonPressed: {
    transform: [{ scale: 0.98 }],
    borderColor: 'rgba(255, 190, 110, 0.6)',
    backgroundColor: 'rgba(40, 20, 8, 0.95)',
  },
  buttonDisabled: {
    opacity: 0.7,
  },
  googleIconContainer: {
    marginRight: 12,
    width: 24,
    height: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  googleButtonText: {
    fontFamily: 'Inter-Bold',
    fontSize: 16,
    color: '#ffffff',
    letterSpacing: 0.3,
  },
  guestLink: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 10,
    paddingHorizontal: 16,
  },
  guestText: {
    fontFamily: 'Inter',
    fontSize: 14,
    color: 'rgba(255, 255, 255, 0.65)',
    textDecorationLine: 'underline',
  },
});
