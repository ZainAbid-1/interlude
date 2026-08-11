import { useCallback, useEffect, useRef } from 'react';
import { createAudioPlayer, setAudioModeAsync } from 'expo-audio';
import type { AudioPlayer } from 'expo-audio';

export const CLIP_DURATION_MS = 3000;

const LOAD_POLL_MS = 100;
const LOAD_TIMEOUT_MS = 10000;

/**
 * Plays a 3-second slice of a preview clip, seeking to `startMs`.
 * A new player is created per source so round changes load cleanly.
 *
 * Playback is deferred until the player has finished loading the remote
 * source (iTunes/Deezer previews stream over HTTP), otherwise `play()` is
 * a silent no-op and the clip is never heard.
 */
export function useClipPlayback(previewUrl: string | null, startMs: number) {
  const playerRef = useRef<AudioPlayer | null>(null);
  const loadTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const clipTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const startMsRef = useRef(startMs);
  startMsRef.current = startMs;

  // Configure audio mode once. Must complete before playback starts so the
  // session is active (silent mode on iOS, no-ducking on Android).
  useEffect(() => {
    setAudioModeAsync({
      playsInSilentMode: true,
      interruptionMode: 'mixWithOthers',
    }).catch(() => {});
  }, []);

  // Create/replace the player whenever the source changes.
  useEffect(() => {
    if (!previewUrl) return;
    const player = createAudioPlayer({ uri: previewUrl });
    player.volume = 1.0;
    playerRef.current = player;
    return () => {
      stopClip();
      player.remove();
      playerRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [previewUrl]);

  const stopClip = useCallback(() => {
    if (loadTimerRef.current) {
      clearInterval(loadTimerRef.current);
      loadTimerRef.current = null;
    }
    if (clipTimerRef.current) {
      clearTimeout(clipTimerRef.current);
      clipTimerRef.current = null;
    }
    const player = playerRef.current;
    if (player?.isLoaded) {
      player.pause();
    }
  }, []);

  const startOnLoaded = useCallback((player: AudioPlayer) => {
    const start = () => {
      const startSeconds = startMsRef.current / 1000;
      player
        .seekTo(startSeconds)
        .then(() => {
          player.play();
          if (clipTimerRef.current) clearTimeout(clipTimerRef.current);
          clipTimerRef.current = setTimeout(() => {
            if (player.isLoaded) player.pause();
          }, CLIP_DURATION_MS);
        })
        .catch(() => {
          player.play();
        });
    };

    // Immediately if already loaded.
    if (player.isLoaded) {
      start();
      return;
    }

    // Otherwise poll until the remote source is buffered.
    if (loadTimerRef.current) clearInterval(loadTimerRef.current);
    const startedAt = Date.now();
    loadTimerRef.current = setInterval(() => {
      if (player.isLoaded) {
        if (loadTimerRef.current) clearInterval(loadTimerRef.current);
        loadTimerRef.current = null;
        start();
      } else if (Date.now() - startedAt > LOAD_TIMEOUT_MS) {
        if (loadTimerRef.current) clearInterval(loadTimerRef.current);
        loadTimerRef.current = null;
      }
    }, LOAD_POLL_MS);
  }, []);

  const playClip = useCallback(() => {
    const player = playerRef.current;
    if (!player) return;
    startOnLoaded(player);
  }, [startOnLoaded]);

  return { playClip, stopClip };
}