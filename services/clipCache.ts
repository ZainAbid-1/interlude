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
/** Never keep more than this many preloaded players waiting. */
const MAX_PRELOADED = 4;
/** URLs whose player the game screen is using right now. */
const inUse = new Set<string>();

/**
 * Previews are streamed (buffered in memory) and never written to the phone:
 * Apple's and Deezer's preview terms allow streaming only, no saved copies.
 */
export function createClipPlayer(url: string): AudioPlayer {
  const player = createAudioPlayer({ uri: url }, { updateInterval: 100 });
  player.volume = 1.0;
  return player;
}

/**
 * Frees a player's native resources NOW.
 *
 * On Android, `remove()` alone only unregisters the player; the ExoPlayer
 * (decoder + audio output) is freed when JS garbage-collects the object or
 * when `release()` is called. Without release(), every match leaked ~10
 * players and after a few matches new clips played silently until the app
 * was restarted.
 *
 * A player that hasn't finished loading its stream yet is released once it
 * has (or after 20s), so release never races the native setup.
 */
export function disposeClipPlayer(player: AudioPlayer) {
  const free = () => {
    try {
      player.pause();
    } catch {}
    try {
      player.remove();
    } catch {}
    try {
      player.release();
    } catch {}
  };
  let loaded = false;
  try {
    loaded = player.isLoaded;
  } catch {}
  if (loaded) {
    free();
    return;
  }
  try {
    player.pause();
  } catch {}
  const startedAt = Date.now();
  const timer = setInterval(() => {
    let ready = true;
    try {
      ready = player.isLoaded;
    } catch {}
    if (ready || Date.now() - startedAt > 20000) {
      clearInterval(timer);
      free();
    }
  }, 500);
}

/** The game screen calls these around using a clip, so it isn't preloaded twice. */
export function markClipInUse(url: string) {
  inUse.add(url);
}
export function markClipDone(url: string) {
  inUse.delete(url);
}

/** Starts buffering a clip in the background. No-op if already cached or playing. */
export function preloadClip(url: string | null | undefined) {
  if (!url || players.has(url) || inUse.has(url)) return;
  try {
    // Oldest preloads go first if too many are waiting.
    while (players.size >= MAX_PRELOADED) {
      const [oldUrl, oldPlayer] = players.entries().next().value as [string, AudioPlayer];
      players.delete(oldUrl);
      disposeClipPlayer(oldPlayer);
    }
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
    players.delete(url);
    disposeClipPlayer(player);
  }
}
