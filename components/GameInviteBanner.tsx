import React, { useEffect, useState } from 'react';
import { View, Text, Image, Pressable, StyleSheet, ActivityIndicator, Alert } from 'react-native';
import { router, usePathname } from 'expo-router';
import Animated, { FadeInUp, FadeOutUp } from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BlurView } from 'expo-blur';
import { PlayerAvatar } from './PlayerAvatar';
import { Colors, Spacing, BorderRadius } from '../constants/theme';
import { useInviteStore } from '../store/inviteStore';
import { useGameStore } from '../store/gameStore';
import { useRoomStore } from '../store/roomStore';

/**
 * App-wide pop-up for an incoming challenge: "@zain challenges you · Drake".
 * Join accepts and drops you straight into their room.
 */
export function GameInviteBanner() {
  const insets = useSafeAreaInsets();
  const pathname = usePathname();
  const invite = useInviteStore((s) => s.incoming[0]);
  const respond = useInviteStore((s) => s.respond);
  const inMatch = useGameStore((s) => s.currentRound !== null && !s.gameOver);
  const [busy, setBusy] = useState<'join' | 'decline' | null>(null);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    if (!invite) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [invite]);

  // Never cover a round in progress; the invite waits until the match ends.
  if (!invite || inMatch) return null;

  const left = Math.max(0, Date.parse(invite.expires_at) - now);
  const mins = Math.floor(left / 60000);
  const secs = Math.floor((left % 60000) / 1000);
  const sender = invite.from_display_name || (invite.from_username ? `@${invite.from_username}` : 'A friend');

  const decline = async () => {
    setBusy('decline');
    await respond(invite, false);
    setBusy(null);
  };

  const join = async () => {
    setBusy('join');
    const res = await respond(invite, true);
    if (res.error || !res.code) {
      setBusy(null);
      Alert.alert("Couldn't join", res.error ?? 'That room is no longer open');
      return;
    }
    // Leave whatever lobby/match we were in, then join like typing the code.
    const game = useGameStore.getState();
    if (game.roomId && !game.gameOver) game.leaveMatch();
    useInviteStore.getState().cancelOutgoing();
    useRoomStore.getState().resetRoom();
    const joined = await useRoomStore.getState().joinRoom(res.code);
    setBusy(null);
    if (!joined.ok) {
      Alert.alert("Couldn't join", joined.error ?? 'Something went wrong');
      return;
    }
    // Already on the game screen (e.g. our own lobby): the new room id
    // re-initialises it; otherwise open it.
    if (pathname !== '/game') router.push('/game');
  };

  return (
    <Animated.View
      key={invite.id}
      entering={FadeInUp.duration(300)}
      exiting={FadeOutUp.duration(200)}
      style={[styles.wrap, { top: insets.top + Spacing.sm }]}
      pointerEvents="box-none"
    >
      <View style={styles.card}>
        <BlurView intensity={60} tint="dark" style={StyleSheet.absoluteFill} />
        <View style={styles.cardTint} />

        <View style={styles.topRow}>
          <PlayerAvatar uri={invite.from_avatar_url} name={sender} size={44} />
          <View style={styles.textCol}>
            <Text style={styles.kicker}>CHALLENGE</Text>
            <Text style={styles.title} numberOfLines={1}>
              {sender} challenges you
            </Text>
            <View style={styles.artistRow}>
              {invite.artist_image_url ? (
                <Image source={{ uri: invite.artist_image_url }} style={styles.artistImage} resizeMethod="resize" />
              ) : (
                <Ionicons name="musical-notes" size={14} color={Colors.textSubtle} />
              )}
              <Text style={styles.artist} numberOfLines={1}>
                {invite.artist_name}
              </Text>
              <Text style={styles.timer}>
                · {mins}:{secs.toString().padStart(2, '0')}
              </Text>
            </View>
          </View>
        </View>

        <View style={styles.buttons}>
          <Pressable onPress={decline} disabled={busy !== null} style={styles.flex}>
            <View style={[styles.button, styles.buttonMuted]}>
              {busy === 'decline' ? (
                <ActivityIndicator size="small" color="#ffffff" />
              ) : (
                <Text style={styles.buttonMutedText}>Decline</Text>
              )}
            </View>
          </Pressable>
          <Pressable onPress={join} disabled={busy !== null} style={styles.flex}>
            <View style={[styles.button, styles.buttonPrimary]}>
              {busy === 'join' ? (
                <ActivityIndicator size="small" color="#000000" />
              ) : (
                <>
                  <Ionicons name="play" size={16} color="#000000" />
                  <Text style={styles.buttonPrimaryText}>Join</Text>
                </>
              )}
            </View>
          </Pressable>
        </View>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    left: Spacing.md,
    right: Spacing.md,
    zIndex: 1000,
    elevation: 1000,
  },
  card: {
    borderRadius: BorderRadius.xl,
    overflow: 'hidden',
    padding: Spacing.md,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.18)',
    gap: Spacing.md,
  },
  cardTint: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(15, 15, 15, 0.85)',
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
  },
  textCol: {
    flex: 1,
    minWidth: 0,
  },
  kicker: {
    fontFamily: 'Inter-Bold',
    fontSize: 10,
    letterSpacing: 1.5,
    color: Colors.textSubtle,
  },
  title: {
    fontFamily: 'Inter-Bold',
    fontSize: 16,
    color: '#ffffff',
    marginTop: 1,
  },
  artistRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 4,
  },
  artistImage: {
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: Colors.surfaceContainer,
  },
  artist: {
    flexShrink: 1,
    fontFamily: 'Inter-Bold',
    fontSize: 13,
    color: 'rgba(255, 255, 255, 0.85)',
  },
  timer: {
    fontFamily: 'Inter',
    fontSize: 13,
    color: Colors.textSubtle,
  },
  buttons: {
    flexDirection: 'row',
    gap: Spacing.sm,
  },
  flex: {
    flex: 1,
  },
  button: {
    height: 42,
    borderRadius: BorderRadius.lg,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  buttonPrimary: {
    backgroundColor: '#ffffff',
  },
  buttonMuted: {
    backgroundColor: 'rgba(255, 255, 255, 0.12)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.18)',
  },
  buttonPrimaryText: {
    fontFamily: 'Inter-Bold',
    fontSize: 15,
    color: '#000000',
  },
  buttonMutedText: {
    fontFamily: 'Inter-Bold',
    fontSize: 15,
    color: '#ffffff',
  },
});
