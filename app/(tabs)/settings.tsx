import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  Image,
  Alert,
  ScrollView,
} from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Colors, Spacing, BorderRadius } from '../../constants/theme';
import { useAuthStore } from '../../store/authStore';
import { GlassCard } from '../../components/GlassCard';
import { AlbumCollageBackground } from '../../components/AlbumCollageBackground';

const WARM_GOLD = '#ffc98a';

export default function SettingsScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const session = useAuthStore((s) => s.session);
  const profile = useAuthStore((s) => s.profile);
  const isGuest = useAuthStore((s) => s.isGuest);
  const signOut = useAuthStore((s) => s.signOut);

  const handleSignOut = () => {
    Alert.alert(
      'Log Out',
      'Are you sure you want to log out?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Log Out',
          style: 'destructive',
          onPress: async () => {
            await signOut();
            router.replace('/login');
          },
        },
      ]
    );
  };

  const handleSignIn = () => {
    router.replace('/login');
  };

  const isLoggedIn = Boolean(session || isGuest);

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      <AlbumCollageBackground />

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[
          styles.scrollContent,
          { paddingBottom: insets.bottom + 100 },
        ]}
        showsVerticalScrollIndicator={false}
      >
        {/* Header */}
        <Animated.View
          entering={FadeInDown.delay(100).duration(500)}
          style={styles.header}
        >
          <Text style={styles.headerTitle}>SETTINGS</Text>
        </Animated.View>

        {/* Profile Card with Google Sign In badge */}
        <Animated.View entering={FadeInDown.delay(200).duration(500)}>
          <GlassCard borderRadius={24} padding={20}>
            <View style={styles.profileRow}>
              {profile?.avatar_url ? (
                <Image source={{ uri: profile.avatar_url }} style={styles.avatarImage} />
              ) : (
                <View style={styles.avatarFallback}>
                  <Ionicons name="person" size={26} color={WARM_GOLD} />
                </View>
              )}
              <View style={styles.profileInfo}>
                <Text style={styles.displayName} numberOfLines={1}>
                  {profile?.display_name ?? (isGuest ? 'Guest Player' : 'Not Signed In')}
                </Text>
                <View style={styles.badgeRow}>
                  {session ? (
                    <View style={styles.providerBadge}>
                      <Ionicons name="logo-google" size={12} color={WARM_GOLD} />
                      <Text style={styles.badgeText}>Signed in with Google</Text>
                    </View>
                  ) : isGuest ? (
                    <View style={styles.providerBadge}>
                      <Ionicons name="person-outline" size={12} color={WARM_GOLD} />
                      <Text style={styles.badgeText}>Guest Account</Text>
                    </View>
                  ) : (
                    <View style={styles.providerBadge}>
                      <Ionicons name="alert-circle-outline" size={12} color={Colors.textMuted} />
                      <Text style={styles.badgeText}>Signed Out</Text>
                    </View>
                  )}
                </View>
              </View>
            </View>
          </GlassCard>
        </Animated.View>

        {/* Log Out / Sign In Action */}
        <Animated.View
          entering={FadeInDown.delay(300).duration(500)}
          style={styles.actionRow}
        >
          {isLoggedIn ? (
            <Pressable
              onPress={handleSignOut}
              style={({ pressed }) => [
                styles.logoutButton,
                pressed && styles.buttonPressed,
              ]}
            >
              <View style={styles.logoutInner}>
                <Ionicons name="log-out-outline" size={20} color="#ff6b6b" />
                <Text style={styles.logoutText} numberOfLines={1}>
                  Log Out
                </Text>
              </View>
            </Pressable>
          ) : (
            <Pressable
              onPress={handleSignIn}
              style={({ pressed }) => [
                styles.loginButton,
                pressed && styles.buttonPressed,
              ]}
            >
              <View style={styles.loginInner}>
                <Ionicons name="logo-google" size={20} color={WARM_GOLD} />
                <Text style={styles.loginText} numberOfLines={1}>
                  Sign In with Google
                </Text>
              </View>
            </Pressable>
          )}
        </Animated.View>

        {/* Footer */}
        <Animated.View
          entering={FadeInDown.delay(400).duration(500)}
          style={styles.footer}
        >
          <Text style={styles.footerText}>Interlude v1.0.0</Text>
        </Animated.View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: '#0a0a0a',
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    padding: Spacing.containerPadding,
    gap: Spacing.lg,
  },
  header: {
    marginBottom: Spacing.xs,
    marginTop: Spacing.md,
  },
  headerTitle: {
    fontFamily: 'Antonio',
    fontSize: 40,
    color: '#ffffff',
    letterSpacing: 3,
    textTransform: 'uppercase',
    lineHeight: 44,
  },
  actionRow: {
    width: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: Spacing.xs,
  },
  profileRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
  },
  avatarImage: {
    width: 52,
    height: 52,
    borderRadius: 26,
    borderWidth: 1.5,
    borderColor: 'rgba(255, 190, 110, 0.4)',
  },
  avatarFallback: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: 'rgba(255, 190, 110, 0.12)',
    borderWidth: 1.5,
    borderColor: 'rgba(255, 190, 110, 0.3)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  profileInfo: {
    flex: 1,
  },
  displayName: {
    fontFamily: 'Inter-Bold',
    fontSize: 18,
    color: '#ffffff',
    marginBottom: 4,
  },
  badgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  providerBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(255, 190, 110, 0.1)',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: BorderRadius.full,
    borderWidth: 1,
    borderColor: 'rgba(255, 190, 110, 0.2)',
  },
  badgeText: {
    fontFamily: 'Inter',
    fontSize: 12,
    color: WARM_GOLD,
  },
  logoutButton: {
    height: 48,
    width: 180,
    alignSelf: 'center',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255, 80, 80, 0.12)',
    borderWidth: 1,
    borderColor: 'rgba(255, 107, 107, 0.35)',
    borderRadius: BorderRadius.full,
  },
  logoutInner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  logoutText: {
    fontFamily: 'Inter-Bold',
    fontSize: 15,
    color: '#ff6b6b',
    includeFontPadding: false,
    textAlignVertical: 'center',
  },
  loginButton: {
    height: 48,
    width: 220,
    alignSelf: 'center',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(26, 13, 5, 0.85)',
    borderWidth: 1.5,
    borderColor: 'rgba(255, 190, 110, 0.35)',
    borderRadius: BorderRadius.full,
  },
  loginInner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  loginText: {
    fontFamily: 'Inter-Bold',
    fontSize: 15,
    color: WARM_GOLD,
    includeFontPadding: false,
    textAlignVertical: 'center',
  },
  buttonPressed: {
    opacity: 0.8,
    transform: [{ scale: 0.98 }],
  },
  footer: {
    alignItems: 'center',
    marginTop: Spacing.sm,
  },
  footerText: {
    fontFamily: 'Inter',
    fontSize: 13,
    color: Colors.textMuted,
  },
});
