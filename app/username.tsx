import React, { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  Pressable,
  StyleSheet,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
} from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { GlassCard } from '../components/GlassCard';
import { AlbumCollageBackground } from '../components/AlbumCollageBackground';
import { Colors, Spacing, BorderRadius } from '../constants/theme';
import { useAuthStore } from '../store/authStore';
import {
  USERNAME_PATTERN,
  isUsernameAvailable,
  normalizeUsername,
  suggestUsername,
} from '../services/friends';

type Check = 'idle' | 'checking' | 'available' | 'taken' | 'invalid' | 'error';

/**
 * Pick (or, with ?edit=1, change) a unique @username — what friends search
 * for. Pre-filled with a free suggestion from the Google name.
 */
export default function UsernameScreen() {
  const insets = useSafeAreaInsets();
  const { edit } = useLocalSearchParams<{ edit?: string }>();
  const isEdit = edit === '1';

  const profile = useAuthStore((s) => s.profile);
  const saveUsername = useAuthStore((s) => s.saveUsername);

  const [value, setValue] = useState(profile?.username ?? '');
  const [check, setCheck] = useState<Check>('idle');
  const [checkError, setCheckError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [pressed, setPressed] = useState(false);
  const seeded = useRef(Boolean(profile?.username));

  // First-time pick: start from a free suggestion based on the Google name.
  useEffect(() => {
    if (seeded.current || !profile) return;
    seeded.current = true;
    (async () => {
      const base = suggestUsername(profile.display_name);
      let candidate = base;
      for (let i = 0; i < 4; i++) {
        const res = await isUsernameAvailable(candidate);
        if (res.data) break;
        if (res.error) break;
        candidate = `${base.slice(0, 16)}${Math.floor(10 + Math.random() * 990)}`;
      }
      setValue((current) => current || candidate);
    })();
  }, [profile]);

  // Live availability check, debounced.
  useEffect(() => {
    const name = normalizeUsername(value);
    setSaveError(null);
    if (!name) {
      setCheck('idle');
      return;
    }
    if (!USERNAME_PATTERN.test(name)) {
      setCheck('invalid');
      return;
    }
    if (name === profile?.username) {
      setCheck('available');
      return;
    }
    setCheck('checking');
    let cancelled = false;
    const timer = setTimeout(async () => {
      const res = await isUsernameAvailable(name);
      if (cancelled) return;
      if (res.error) {
        setCheck('error');
        setCheckError(res.error);
      } else {
        setCheck(res.data ? 'available' : 'taken');
      }
    }, 400);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [value, profile?.username]);

  const name = normalizeUsername(value);
  const canSave = check === 'available' && !saving;

  const handleSave = async () => {
    if (!canSave) return;
    setSaving(true);
    const res = await saveUsername(name);
    setSaving(false);
    if (res.error) {
      setSaveError(res.error);
      if (/taken/i.test(res.error)) setCheck('taken');
      return;
    }
    if (isEdit && router.canGoBack()) router.back();
    else router.replace('/(tabs)');
  };

  const status = (() => {
    switch (check) {
      case 'checking':
        return { icon: null, color: Colors.textSubtle, text: 'Checking…' };
      case 'available':
        return {
          icon: 'checkmark-circle' as const,
          color: Colors.correct,
          text: name === profile?.username ? 'This is your username' : `@${name} is available`,
        };
      case 'taken':
        return { icon: 'close-circle' as const, color: Colors.incorrect, text: `@${name} is taken` };
      case 'invalid':
        return {
          icon: 'information-circle' as const,
          color: Colors.textSubtle,
          text: '3–20 characters: letters, numbers, _ and .',
        };
      case 'error':
        return { icon: 'alert-circle' as const, color: Colors.incorrect, text: checkError ?? 'Could not check' };
      default:
        return null;
    }
  })();

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      <AlbumCollageBackground />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView
          contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 40 }]}
          keyboardShouldPersistTaps="handled"
        >
          {isEdit ? (
            <Pressable onPress={() => router.back()} hitSlop={10} style={styles.backButton}>
              <Ionicons name="chevron-back" size={22} color={Colors.primary} />
            </Pressable>
          ) : null}

          <Animated.View entering={FadeInDown.delay(100).duration(500)}>
            <Text style={styles.headerTitle}>{isEdit ? 'Change username' : 'Pick a username'}</Text>
            <Text style={styles.subtitle}>
              Friends find you by this. You can change it later in Settings.
            </Text>
          </Animated.View>

          <Animated.View entering={FadeInDown.delay(250).duration(500)}>
            <GlassCard borderRadius={24}>
              <Text style={styles.label}>Username</Text>
              <View
                style={[
                  styles.inputRow,
                  check === 'available' && styles.inputRowOk,
                  check === 'taken' && styles.inputRowBad,
                ]}
              >
                <Text style={styles.at}>@</Text>
                <TextInput
                  style={styles.input}
                  value={value}
                  onChangeText={(t) => setValue(normalizeUsername(t))}
                  placeholder="your_name"
                  placeholderTextColor={Colors.textMuted}
                  autoCapitalize="none"
                  autoCorrect={false}
                  autoFocus={isEdit}
                  maxLength={20}
                  returnKeyType="done"
                  onSubmitEditing={handleSave}
                />
                {check === 'checking' ? <ActivityIndicator size="small" color={Colors.textSubtle} /> : null}
              </View>

              <View style={styles.statusRow}>
                {status?.icon ? <Ionicons name={status.icon} size={16} color={status.color} /> : null}
                {status ? <Text style={[styles.statusText, { color: status.color }]}>{status.text}</Text> : null}
              </View>

              {saveError && check !== 'taken' ? <Text style={styles.saveError}>{saveError}</Text> : null}

              {/* NativeWind drops function-style Pressable styles: style the inner View. */}
              <Pressable
                onPress={handleSave}
                onPressIn={() => setPressed(true)}
                onPressOut={() => setPressed(false)}
                disabled={!canSave}
              >
                <View
                  style={[
                    styles.primaryButton,
                    !canSave && styles.buttonDisabled,
                    pressed && canSave && styles.buttonPressed,
                  ]}
                >
                  {saving ? (
                    <ActivityIndicator size="small" color="#000000" />
                  ) : (
                    <>
                      <Text style={styles.primaryButtonText}>{isEdit ? 'Save' : 'Continue'}</Text>
                      <Ionicons name="arrow-forward" size={18} color="#000000" />
                    </>
                  )}
                </View>
              </Pressable>
            </GlassCard>
          </Animated.View>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  content: {
    padding: Spacing.containerPadding,
    gap: Spacing.lg,
    flexGrow: 1,
    justifyContent: 'center',
  },
  backButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    fontFamily: 'Antonio',
    fontSize: 40,
    lineHeight: 46,
    color: '#ffffff',
    letterSpacing: 2,
    textTransform: 'uppercase',
    textShadowColor: 'rgba(0, 0, 0, 0.95)',
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 8,
  },
  subtitle: {
    fontFamily: 'Inter-Bold',
    fontSize: 15,
    color: '#ffffff',
    opacity: 0.9,
    marginTop: 6,
    textShadowColor: 'rgba(0, 0, 0, 0.95)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 6,
  },
  label: {
    fontFamily: 'Inter-Bold',
    fontSize: 15,
    color: Colors.primary,
    marginBottom: Spacing.sm,
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
    borderRadius: BorderRadius.md,
    borderWidth: 1,
    borderColor: Colors.glassBorder,
    paddingHorizontal: Spacing.md,
    paddingVertical: 12,
  },
  inputRowOk: {
    borderColor: 'rgba(74, 222, 128, 0.5)',
  },
  inputRowBad: {
    borderColor: 'rgba(248, 113, 113, 0.5)',
  },
  at: {
    fontFamily: 'Inter-Bold',
    fontSize: 18,
    color: Colors.textSubtle,
  },
  input: {
    flex: 1,
    fontFamily: 'Inter-Bold',
    fontSize: 18,
    color: Colors.primary,
    padding: 0,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    minHeight: 22,
    marginTop: Spacing.sm,
    marginBottom: Spacing.md,
  },
  statusText: {
    fontFamily: 'Inter',
    fontSize: 13,
  },
  saveError: {
    fontFamily: 'Inter',
    fontSize: 13,
    color: Colors.incorrect,
    marginBottom: Spacing.md,
  },
  primaryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.xs,
    backgroundColor: '#ffffff',
    borderRadius: BorderRadius.lg,
    paddingVertical: 14,
  },
  primaryButtonText: {
    fontFamily: 'Inter-Bold',
    fontSize: 15,
    color: '#000000',
  },
  buttonDisabled: {
    opacity: 0.35,
  },
  buttonPressed: {
    opacity: 0.85,
  },
});
