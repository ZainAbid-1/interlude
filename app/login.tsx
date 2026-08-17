import React, { useState } from 'react';
import {
  View,
  Text,
  Pressable,
  StyleSheet,
  ActivityIndicator,
  Alert,
  Dimensions,
} from 'react-native';
import { useRouter } from 'expo-router';
import Animated, { FadeInDown, FadeInUp } from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import { AlbumCollageBackground } from '../components/AlbumCollageBackground';
import { useAuthStore } from '../store/authStore';
import { Colors, Spacing, BorderRadius } from '../constants/theme';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
// Scale the wordmark so "INTERLUDE." always fits in full on small screens.
const TITLE_FONT_SIZE = Math.min(58, SCREEN_WIDTH * 0.14);
const TITLE_LETTER_SPACING = Math.min(6, SCREEN_WIDTH * 0.012);

export default function LoginScreen() {
  const router = useRouter();
  const signInWithGoogle = useAuthStore((s) => s.signInWithGoogle);
  const [signingIn, setSigningIn] = useState(false);

  const handleGoogleSignIn = async () => {
    setSigningIn(true);
    try {
      const { error } = await signInWithGoogle();
      setSigningIn(false);
      if (error) {
        Alert.alert('Google Sign-In', error, [{ text: 'OK' }]);
      } else {
        router.replace('/(tabs)');
      }
    } catch (e) {
      setSigningIn(false);
      Alert.alert('Sign-in Error', (e as Error)?.message ?? 'An unexpected error occurred');
    }
  };

  return (
    <View style={styles.container}>
      <AlbumCollageBackground />

      <View style={styles.content}>
        {/* Title in exact Antonio font in the middle of the screen */}
        <Animated.View entering={FadeInDown.delay(100).duration(800)} style={styles.titleContainer}>
          <Text style={styles.title}>INTERLUDE.</Text>
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
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center' }}>
              {signingIn ? (
                <ActivityIndicator color="#ffffff" size="small" style={{ marginRight: 8 }} />
              ) : (
                <View style={styles.googleIconContainer}>
                  <Ionicons name="logo-google" size={20} color="#ffffff" />
                </View>
              )}
              <Text style={styles.googleButtonText} numberOfLines={1}>
                {signingIn ? 'Signing in...' : 'Sign in with Google'}
              </Text>
            </View>
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
    fontSize: TITLE_FONT_SIZE,
    color: '#ffffff',
    letterSpacing: TITLE_LETTER_SPACING,
    textTransform: 'uppercase',
    textAlign: 'center',
    lineHeight: TITLE_FONT_SIZE * 1.12,
    textShadowColor: 'rgba(255, 255, 255, 0.35)',
    textShadowOffset: { width: 0, height: 4 },
    textShadowRadius: 16,
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
    backgroundColor: 'rgba(20, 20, 20, 0.85)',
    borderWidth: 1.5,
    borderColor: 'rgba(255, 255, 255, 0.35)',
    borderRadius: BorderRadius.full,
    paddingHorizontal: 24,
    shadowColor: '#ffffff',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 12,
    elevation: 8,
  },
  buttonPressed: {
    transform: [{ scale: 0.98 }],
    borderColor: 'rgba(255, 255, 255, 0.6)',
    backgroundColor: 'rgba(40, 40, 40, 0.95)',
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
});
