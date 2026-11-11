/**
 * Music catalog client.
 *
 * Artist search and track catalogs come from Deezer's public API (free, no
 * key). Playable 30s previews come from iTunes first, because Deezer preview
 * links are signed and expire after ~15 minutes — too short for a room that
 * sits in the lobby — with the Deezer preview as a last resort.
 *
 * This used to be the Spotify Web API (Client Credentials). Spotify now
 * rejects every call from apps whose owner lacks Premium (HTTP 403 "Active
 * premium subscription required for the owner of the app"), which surfaced
 * as "No artists found". The file name and exported types are kept so the
 * rest of the app (and the `spotify_*` DB columns, which now hold Deezer
 * ids) need no changes.
 */

export interface SpotifyArtist {
  id: string;
  name: string;
  image: string;
}

const DEEZER_API = 'https://api.deezer.com';

async function getJson(url: string): Promise<any | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) {
      console.warn('[catalog] HTTP', res.status, url);
      return null;
    }
    const data = await res.json();
    // Deezer reports quota/other errors with a 200 + { error: {...} } body.
    if (data?.error) {
      console.warn('[catalog] API error', data.error?.message ?? data.error, url);
      return null;
    }
    return data;
  } catch (e) {
    console.warn('[catalog] request failed', url, e);
    return null;
  }
}

function parseDeezerArtist(item: any): SpotifyArtist {
  return {
    id: String(item.id),
    name: item.name,
    image: item.picture_xl || item.picture_big || item.picture_medium || '',
  };
}

/**
 * Deezer's artist search ranks loosely (e.g. "drake" returns an obscure
 * namesake first), so results are re-ranked by fan count.
 */
async function searchDeezerArtists(query: string, limit: number): Promise<SpotifyArtist[]> {
  const data = await getJson(
    `${DEEZER_API}/search/artist?q=${encodeURIComponent(query)}&limit=${Math.max(limit, 10)}`
  );
  const items: any[] = data?.data ?? [];
  return items
    .sort((a, b) => (b?.nb_fan ?? 0) - (a?.nb_fan ?? 0))
    .slice(0, limit)
    .map(parseDeezerArtist);
}

/**
 * Curated "top artists" list, refreshed live (names + images) from Deezer.
 * Falls back to the static list if the network is unavailable.
 */
export async function getTopArtists(limit = 6): Promise<SpotifyArtist[]> {
  const queries = [
    'Radiohead',
    'Arctic Monkeys',
    'Daft Punk',
    'Tame Impala',
    'The Weeknd',
    'Taylor Swift',
    'Drake',
    'Kendrick Lamar',
  ];
  const results = await Promise.all(
    queries.map(async (name) => (await searchDeezerArtists(name, 1))[0] ?? null)
  );
  const artists = results.filter((a): a is SpotifyArtist => a !== null);
  if (artists.length === 0) return FALLBACK_TOP_ARTISTS.slice(0, limit);
  return artists.slice(0, limit);
}

/**
 * Live artist search for the Create Room flow. If the catalog can't be
 * reached, falls back to filtering the curated list locally.
 */
export async function searchArtists(
  query: string,
  limit = 6
): Promise<SpotifyArtist[]> {
  const q = query.trim();
  if (!q) return [];

  const live = await searchDeezerArtists(q, limit);
  if (live.length > 0) return live;

  const needle = q.toLowerCase();
  return FALLBACK_TOP_ARTISTS.filter((a) =>
    a.name.toLowerCase().includes(needle)
  ).slice(0, limit);
}

export const FALLBACK_TOP_ARTISTS: SpotifyArtist[] = [
  {
    id: 'radiohead',
    name: 'Radiohead',
    image: 'https://i.scdn.co/image/ab6761610000e5eba03696716c9ee605006047fd',
  },
  {
    id: 'arctic-monkeys',
    name: 'Arctic Monkeys',
    image: 'https://i.scdn.co/image/ab6761610000e5eb7da39dea0a72f581535571da',
  },
  {
    id: 'daft-punk',
    name: 'Daft Punk',
    image: 'https://i.scdn.co/image/ab6761610000e5ebba7bfd7835b5c1eee0c95af6e',
  },
  {
    id: 'tame-impala',
    name: 'Tame Impala',
    image: 'https://i.scdn.co/image/ab6761610000e5ebbe3e82e7b6abcdd0e29a5fbf',
  },
  {
    id: 'the-weeknd',
    name: 'The Weeknd',
    image: 'https://i.scdn.co/image/ab6761610000e5eb214f3cf1cbe7139c1ec26ffbb',
  },
];

// ─── Track pool generation ───────────────────────────────────────────

export interface TrackPoolItem {
  spotifyTrackId: string;
  trackName: string;
  albumArtUrl: string;
  previewUrl: string;
  previewSource: 'itunes' | 'deezer';
  clipStartMs: number;
  durationMs: number;
}

interface TrackCandidate {
  id: string;
  name: string;
  albumArtUrl: string;
}

interface ResolvedPreview {
  url: string;
  source: 'itunes' | 'deezer';
  /** Length of the preview FILE (both iTunes + Deezer previews are ~30s),
   *  NOT the full track. Used to pick a clip start that actually fits. */
  durationMs: number;
}

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

interface DeezerCandidate extends TrackCandidate {
  /** Deezer's own preview (signed, expires ~15 min) — last-resort fallback. */
  deezerPreview: string;
}

/**
 * Resolves a Deezer artist id. Curated fallback artists carry slug ids
 * (e.g. "radiohead"), so those are looked up by name.
 */
async function resolveDeezerArtistId(artistId: string, artistName: string): Promise<string | null> {
  if (/^\d+$/.test(artistId)) return artistId;
  const match = (await searchDeezerArtists(artistName, 1))[0];
  return match?.id ?? null;
}

/**
 * Collects candidate tracks for an artist from Deezer, deduped by title:
 * top tracks first (popular, recognisable), then album/single tracks for a
 * deeper catalog to draw distractors from.
 */
async function collectCandidates(
  artistId: string,
  cap = 40
): Promise<DeezerCandidate[]> {
  const byName = new Map<string, DeezerCandidate>();
  const push = (items: any[], fallbackArt = '') => {
    for (const t of items) {
      if (byName.size >= cap) return;
      // Only tracks actually credited to this artist.
      if (t?.artist?.id != null && String(t.artist.id) !== artistId) continue;
      const name: string = t?.title_short || t?.title || '';
      const key = normalizeName(name);
      if (!key || byName.has(key)) continue;
      byName.set(key, {
        id: String(t.id),
        name,
        albumArtUrl: t?.album?.cover_big || t?.album?.cover_xl || fallbackArt,
        deezerPreview: t?.preview || '',
      });
    }
  };

  // 1. Top tracks
  const top = await getJson(`${DEEZER_API}/artist/${artistId}/top?limit=100`);
  push(top?.data ?? []);

  // 2. Albums + singles for a deeper catalog
  if (byName.size < cap) {
    const albums = await getJson(`${DEEZER_API}/artist/${artistId}/albums?limit=50`);
    for (const album of (albums?.data ?? []) as any[]) {
      if (byName.size >= cap) break;
      const tracks = await getJson(`${DEEZER_API}/album/${album.id}/tracks?limit=50`);
      push(tracks?.data ?? [], album?.cover_big || album?.cover_xl || '');
    }
  }

  return Array.from(byName.values()).slice(0, cap);
}

/**
 * One iTunes search for the whole artist (instead of one per track — iTunes
 * throttles at roughly 20 requests/minute). Maps normalized track name →
 * preview URL for tracks credited to the artist.
 */
async function fetchItunesPreviews(artistName: string): Promise<Map<string, string>> {
  const byName = new Map<string, string>();
  const data = await getJson(
    `https://itunes.apple.com/search?term=${encodeURIComponent(artistName)}&entity=song&attribute=artistTerm&limit=200`
  );
  for (const r of (data?.results ?? []) as any[]) {
    if (!r?.previewUrl || !r?.trackName) continue;
    if (!sameArtistName(artistName, r.artistName ?? '')) continue;
    const key = normalizeName(r.trackName);
    if (key && !byName.has(key)) byName.set(key, r.previewUrl);
  }
  return byName;
}

function findItunesPreview(previews: Map<string, string>, trackName: string): string | null {
  const exact = previews.get(normalizeName(trackName));
  if (exact) return exact;
  for (const [name, url] of previews) {
    if (sameTrackName(trackName, name)) return url;
  }
  return null;
}

/**
 * Resolves a free 3-second-playable preview for a track:
 * iTunes Search API first, Deezer as fallback.
 */
/**
 * Normalizes a name for tolerant comparison: lowercase, strips accents and
 * punctuation, collapses whitespace. Used to verify a preview search result
 * really is the artist + track we asked for (many songs share titles).
 */
function normalizeName(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * True when `query` and `candidate` describe the same track title, allowing
 * small differences like "(Remastered)" or "feat. ..." suffixes.
 */
function sameTrackName(query: string, candidate: string): boolean {
  const q = normalizeName(query);
  const c = normalizeName(candidate);
  if (!q || !c) return false;
  return q === c || q.includes(c) || c.includes(q);
}

/** True when `query` and `candidate` are the same artist name. */
function sameArtistName(query: string, candidate: string): boolean {
  const q = normalizeName(query);
  const c = normalizeName(candidate);
  return !!q && !!c && (q === c || q.includes(c) || c.includes(q));
}

/**
 * Resolves a free 3-second-playable preview for a track:
 * iTunes Search API first, Deezer as fallback.
 *
 * Results are matched against BOTH the requested artist name and track name,
 * otherwise a same-titled song by a different artist can leak into the pool
 * (e.g. a cartoon "Hello Kitty" instead of the artist's track).
 */
async function resolvePreview(
  artistName: string,
  trackName: string
): Promise<ResolvedPreview | null> {
  // 1. iTunes
  try {
    const term = encodeURIComponent(`${artistName} ${trackName}`);
    const res = await fetch(
      `https://itunes.apple.com/search?term=${term}&entity=song&limit=25`
    );
    if (res.ok) {
      const data = await res.json();
      const results: any[] = data?.results ?? [];
      for (const result of results) {
        if (!result?.previewUrl) continue;
        // Must actually be by the requested artist.
        if (!sameArtistName(artistName, result.artistName ?? '')) continue;
        if (!sameTrackName(trackName, result.trackName ?? '')) continue;
        // iTunes preview files are standardized to ~30 seconds regardless of
        // the full track length, so never use trackTimeMillis (full track).
        return {
          url: result.previewUrl,
          source: 'itunes',
          durationMs: 30000,
        };
      }
    }
  } catch (e) {
    // fall through to Deezer
  }

  // 2. Deezer
  try {
    const q = encodeURIComponent(`artist:"${artistName}" track:"${trackName}"`);
    const res = await fetch(`https://api.deezer.com/search?q=${q}&limit=10`);
    if (res.ok) {
      const data = await res.json();
      const results: any[] = data?.data ?? [];
      for (const result of results) {
        if (!result?.preview) continue;
        if (!sameArtistName(artistName, result?.artist?.name ?? '')) continue;
        if (!sameTrackName(trackName, result?.title ?? '')) continue;
        return { url: result.preview, source: 'deezer', durationMs: 30000 };
      }
    }
  } catch (e) {
    // no preview available
  }

  return null;
}

/**
 * Picks a clip start offset for the 3-second clip: a few seconds past the
 * likely intro silence, random within a window so rounds aren't predictable.
 */
function pickClipStart(durationMs: number): number {
  const previewMs = Math.min(durationMs, 30000); // preview files are ~30s
  const latest = Math.max(0, previewMs - 3000);
  if (latest <= 0) return 0;
  const min = 4000;
  const start = Math.min(min, latest) + Math.floor(Math.random() * Math.max(1, latest - Math.min(min, latest)));
  return Math.round(start);
}

/**
 * Builds a room track pool for an artist: up to `limit` tracks that
 * have a resolvable free preview. Returns [] if credentials are missing
 * or the catalog has no playable previews (host should pick another
 * artist or more candidates should be pulled).
 *
 * Candidates are shuffled before previews are resolved so the pool is a
 * varied slice of the catalog rather than the obvious top-10 hits.
 *
 * The same-artist tracks that DIDN'T make the playable pool are returned as
 * `optionNames` — the answer distractors. Keeping them from the artist's own
 * catalog (not the 10 featured songs) is what makes rounds unpredictable:
 * you're guessing from real tracks, just not the ones already on screen.
 */
export async function getArtistTrackPool(
  artistId: string,
  artistName: string,
  limit = 10
): Promise<ArtistTrackPool> {
  try {
    const deezerId = await resolveDeezerArtistId(artistId, artistName);
    if (!deezerId) return { tracks: [], optionNames: [] };

    // Fetch a wide slice of the catalog so we have plenty of same-artist names
    // to draw alternatives from after the playable pool is filled.
    const [catalog, itunes] = await Promise.all([
      collectCandidates(deezerId, limit * 6),
      fetchItunesPreviews(artistName),
    ]);
    const candidates = shuffle(catalog);
    const tracks: TrackPoolItem[] = [];
    const chosen = new Set<string>();

    // Per-track iTunes lookups are rate limited, so cap them; the Deezer
    // preview (short-lived) is the final fallback.
    let lookupsLeft = 8;
    for (const track of candidates) {
      if (tracks.length >= limit) break;
      let preview: ResolvedPreview | null = null;
      const bulk = findItunesPreview(itunes, track.name);
      if (bulk) {
        preview = { url: bulk, source: 'itunes', durationMs: 30000 };
      } else if (lookupsLeft > 0) {
        lookupsLeft--;
        preview = await resolvePreview(artistName, track.name);
      }
      if (!preview && track.deezerPreview) {
        preview = { url: track.deezerPreview, source: 'deezer', durationMs: 30000 };
      }
      if (!preview) continue;

      chosen.add(track.id);
      tracks.push({
        spotifyTrackId: track.id,
        trackName: track.name,
        albumArtUrl: track.albumArtUrl,
        previewUrl: preview.url,
        previewSource: preview.source,
        durationMs: preview.durationMs,
        clipStartMs: pickClipStart(preview.durationMs),
      });
    }

    const optionNames = candidates
      .filter((t) => !chosen.has(t.id) && t.name)
      .map((t) => t.name)
      .filter((n, i, all) => all.indexOf(n) === i);

    return { tracks, optionNames };
  } catch (e) {
    console.warn('[catalog] track pool failed', e);
    return { tracks: [], optionNames: [] };
  }
}

export interface ArtistTrackPool {
  /** The playable tracks featured in the game (have free previews). */
  tracks: TrackPoolItem[];
  /** Other same-artist track names, usable as answer distractors. */
  optionNames: string[];
}