import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * Remembers the match this phone is playing, so if the app is closed or
 * crashes mid-match, reopening it can offer to rejoin.
 */
export interface ActiveMatch {
  roomId: string;
  code: string;
  isHost: boolean;
  artistName: string;
  savedAt: number;
}

const KEY = 'interlude.activeMatch.v1';
/** A match this old is over for sure (the other player claims the win at ~1 min). */
const MAX_AGE_MS = 3 * 60 * 1000;

export async function saveActiveMatch(m: Omit<ActiveMatch, 'savedAt'>) {
  try {
    await AsyncStorage.setItem(KEY, JSON.stringify({ ...m, savedAt: Date.now() }));
  } catch {
    // Storage unavailable: rejoining just won't be offered.
  }
}

export async function clearActiveMatch() {
  try {
    await AsyncStorage.removeItem(KEY);
  } catch {}
}

export async function readActiveMatch(): Promise<ActiveMatch | null> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (!raw) return null;
    const m = JSON.parse(raw) as ActiveMatch;
    if (!m?.roomId || Date.now() - m.savedAt > MAX_AGE_MS) {
      await clearActiveMatch();
      return null;
    }
    return m;
  } catch {
    return null;
  }
}
