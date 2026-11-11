import { Image } from 'react-native';
import { createAudioPlayer } from 'expo-audio';
import type { AudioPlayer } from 'expo-audio';

/**
 * Album-art prefetches, keyed by URL. The game screen only mounts the cover
 * at the reveal, so without this the image starts downloading at the reveal
 * and often isn't there before the round moves on. Each promise settles
 * (true = cached, false = failed) so the store can wait for it.
 */
const covers = new Map<string, Promise<boolean>>();

export function preloadCover(url: string | null | undefined): Promise<boolean> {
  if (!url) return Promise.resolve(true);
  let p = covers.get(url);
  if (!p) {
    p = Image.prefetch(url).then(
      (ok) => ok !== false,
      () => false
    );
    covers.set(url, p);
    // Let a failed prefetch be retried next time it is asked for.
    p.then((ok) => {
      if (!ok) covers.delete(url);
    });
  }
  return p;
}

/**
 * Preloaded clip players, keyed by preview URL.
 *
 * Without this, a round's MP3 only starts downloading when the round's
 * countdown begins, so a phone on a slow connection can still be buffering
 * when the other phone is already playing. The game store preloads the next
 * rounds' clips here; `useClipPlayback` then *takes* the ready player (and
 * becomes responsible for removing it) instead of creating a fresh one.
 */
const players = new Map<string, AudioPlayer>();

export function createClipPlayer(url: string): AudioPlayer {
  const player = createAudioPlayer({ uri: url }, { downloadFirst: true, updateInterval: 100 });
  player.volume = 1.0;
  return player;
}

/** Starts buffering a clip in the background. No-op if already cached. */
export function preloadClip(url: string | null | undefined) {
  if (!url || players.has(url)) return;
  try {
    players.set(url, createClipPlayer(url));
  } catch (e) {
    console.log('[clipCache] preload failed', e);
  }
}

/** Hands over a preloaded player (removing it from the cache), if any. */
export function takeClip(url: string): AudioPlayer | null {
  const player = players.get(url);
  if (!player) return null;
  players.delete(url);
  return player;
}

/** Releases cached players, except URLs listed in `keep`. */
export function clearClips(keep: Iterable<string> = []) {
  covers.clear();
  const keepSet = new Set(keep);
  for (const [url, player] of players) {
    if (keepSet.has(url)) continue;
    try {
      player.remove();
    } catch {
      // already released
    }
    players.delete(url);
  }
}
