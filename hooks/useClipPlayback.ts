import { useCallback, useEffect, useRef, useState } from 'react';
import { createAudioPlayer, setAudioModeAsync } from 'expo-audio';
import type { AudioPlayer, AudioStatus } from 'expo-audio';

export const CLIP_DURATION_MS = 3000;

const LOAD_POLL_MS = 100;
const LOAD_TIMEOUT_MS = 10000;

/**
 * Plays a 3-second slice of a preview clip, seeking to `startMs`.
 * A new player is created per source so round changes load cleanly.
 *
 * `downloadFirst` fully buffers the remote MP3 (iTunes/Deezer previews) before
 * playback is allowed. This is what avoids the "silent no-op" where `play()`
 * is called on a not-yet-buffered player over a spotty mobile connection.
 *
 * `clipStarted` flips to `true` only when the player actually reports it is
 * playing (a real `playbackStatusUpdate`), NOT when `playClip()` is called.
 * Consumers use it to start progress/elapsed UI so the bar never runs ahead of
 * the audible audio while the clip is still buffering.
 */
export function useClipPlayback(previewUrl: string | null, startMs: number) {
  const playerRef = useRef<AudioPlayer | null>(null);
  const loadTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const clipTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const startMsRef = useRef(startMs);
  startMsRef.current = startMs;

  const [clipStarted, setClipStarted] = useState(false);

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
    if (!previewUrl) {
      console.log('[useClipPlayback] previewUrl is null/empty');
      return;
    }
    console.log('[useClipPlayback] Creating player for:', previewUrl);
    const player = createAudioPlayer(
      { uri: previewUrl },
      { downloadFirst: true, updateInterval: 100 }
    );
    player.volume = 1.0;
    setClipStarted(false);
    playerRef.current = player;

    // The player reports play/pause/position every `updateInterval` ms. We only
    // care about the first transition into playing — that is the moment audio
    // is truly audible, which is when the on-screen progress must begin.
    const statusSub = player.addListener(
      'playbackStatusUpdate',
      (status: AudioStatus) => {
        if (status.playing) {
          setClipStarted(true);
        }
      }
    );

    return () => {
      statusSub.remove();
      stopClip();
      player.remove();
      playerRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [previewUrl]);

  const startOnLoaded = useCallback((player: AudioPlayer) => {
    const start = () => {
      let startSeconds = startMsRef.current / 1000;

      // Old pools can store a clip start computed against the FULL track
      // length (minutes) which exceeds the ~30s preview file. Seeking past
      // the end clamps to EOF → silence, so clamp to a window that still
      // fits the whole 3-second clip.
      if (player.isLoaded && player.duration > 0) {
        const maxStart = Math.max(0, player.duration - CLIP_DURATION_MS / 1000 - 0.02);
        if (startSeconds > maxStart) startSeconds = maxStart;
      }

      player
        .seekTo(startSeconds)
        .then(() => {
          console.log('[useClipPlayback] Playing clip from', startSeconds, 's');
          player.play();
          if (clipTimerRef.current) clearTimeout(clipTimerRef.current);
          clipTimerRef.current = setTimeout(() => {
            if (player.isLoaded) player.pause();
          }, CLIP_DURATION_MS);
        })
        .catch((e) => {
          console.log('[useClipPlayback] seekTo failed, playing anyway:', e);
          player.play();
        });
    };

    const clearLoadTimer = () => {
      if (loadTimerRef.current) {
        clearInterval(loadTimerRef.current);
        loadTimerRef.current = null;
      }
    };

    // Immediately if already loaded and not buffering.
    if (player.isLoaded && !player.isBuffering) {
      console.log('[useClipPlayback] Already loaded, starting immediately');
      start();
      return;
    }

    // Otherwise poll until the remote source is buffered.
    if (loadTimerRef.current) clearInterval(loadTimerRef.current);
    const startedAt = Date.now();
    loadTimerRef.current = setInterval(() => {
      if (player.isLoaded && !player.isBuffering) {
        clearLoadTimer();
        console.log('[useClipPlayback] Loaded after', Date.now() - startedAt, 'ms');
        start();
      } else if (Date.now() - startedAt > LOAD_TIMEOUT_MS) {
        clearLoadTimer();
        console.log('[useClipPlayback] Load timeout, trying to play anyway');
        // Fallback: try playing even if not fully loaded.
        start();
      }
    }, LOAD_POLL_MS);
  }, []);

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

  const playClip = useCallback(() => {
    const player = playerRef.current;
    if (!player) {
      console.log('[useClipPlayback] playClip called but no player');
      return;
    }
    // A fresh round always starts un-started so the progress bar begins at 0
    // until the player actually reports playing.
    setClipStarted(false);
    startOnLoaded(player);
  }, [startOnLoaded]);

  return { playClip, stopClip, clipStarted };
}