/**
 * Music catalog client — Spotify first, Deezer as the fallback.
 *
 * Artist search and track catalogs come from the Spotify Web API (Client
 * Credentials) when it is available: best catalog + current artist photos.
 * Spotify refuses every call while the developer app's owner has no Premium
 * (HTTP 403 "Active premium subscription required for the owner of the
 * app"); on that, rate limiting or outages Spotify is put on a short
 * cooldown and Deezer's free, keyless API answers instead, so search never
 * collapses into "No artists found".
 *
 * Playable 30s previews come from iTunes first (Spotify no longer serves
 * previews to new apps, and Deezer's preview links expire after ~15
 * minutes), with Deezer previews as a last resort.
 *
 * Artist/track ids are Spotify ids (22-char base62) or Deezer ids (numeric);
 * the `spotify_*` DB columns store whichever source produced the pool.
 */

export interface SpotifyArtist {
  id: string;
  name: string;
  /** ~500px picture for larger displays. */
  image: string;
  /** ~250px picture for small avatars (search rows). Falls back to `image`. */
  thumb?: string;
}

// ─── Spotify ──────────────────────────────────────────────────────────

const SPOTIFY_TOKEN_ENDPOINT = 'https://accounts.spotify.com/api/token';
const SPOTIFY_API = 'https://api.spotify.com/v1';
const CLIENT_ID = (process.env.EXPO_PUBLIC_SPOTIFY_CLIENT_ID ?? '').trim();
const CLIENT_SECRET = (process.env.EXPO_PUBLIC_SPOTIFY_CLIENT_SECRET ?? '').trim();
const hasSpotifyCredentials = CLIENT_ID.length > 0 && CLIENT_SECRET.length > 0;

/** After Spotify refuses (403/429/5xx), skip it for this long. */
const SPOTIFY_COOLDOWN_MS = 5 * 60 * 1000;
let spotifyDownUntil = 0;
let cachedToken: { value: string; expiresAt: number } | null = null;

function spotifyAvailable(): boolean {
  return hasSpotifyCredentials && Date.now() >= spotifyDownUntil;
}

function markSpotifyDown(reason: string, ms = SPOTIFY_COOLDOWN_MS) {
  spotifyDownUntil = Date.now() + ms;
  console.warn(`[catalog] Spotify unavailable (${reason}); using Deezer for ${Math.round(ms / 1000)}s`);
}

const BASE64_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
function base64Encode(input: string): string {
  const bytes = Array.from(input).map((c) => c.charCodeAt(0) & 0xff);
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const [b1, b2, b3] = [bytes[i], bytes[i + 1], bytes[i + 2]];
    out += BASE64_CHARS[b1 >> 2];
    out += BASE64_CHARS[((b1 & 3) << 4) | ((b2 ?? 0) >> 4)];
    out += b2 === undefined ? '=' : BASE64_CHARS[((b2 & 15) << 2) | ((b3 ?? 0) >> 6)];
    out += b3 === undefined ? '=' : BASE64_CHARS[b3 & 63];
  }
  return out;
}

async function getSpotifyToken(): Promise<string | null> {
  if (cachedToken && cachedToken.expiresAt > Date.now()) return cachedToken.value;
  try {
    const res = await fetch(SPOTIFY_TOKEN_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: `Basic ${base64Encode(`${CLIENT_ID}:${CLIENT_SECRET}`)}`,
      },
      body: 'grant_type=client_credentials',
    });
    const data = await res.json();
    if (!data?.access_token) {
      markSpotifyDown(`auth ${res.status}`);
      return null;
    }
    cachedToken = {
      value: data.access_token,
      expiresAt: Date.now() + ((data.expires_in ?? 3600) - 60) * 1000,
    };
    return cachedToken.value;
  } catch (e) {
    markSpotifyDown('auth request failed');
    return null;
  }
}

/**
 * GET a Spotify endpoint. Returns null on any failure. `critical` calls
 * (search) put Spotify on cooldown when refused; optional endpoints (top
 * tracks, albums) that may be restricted on their own just return null.
 */
async function spotifyGet(path: string, critical = true): Promise<any | null> {
  if (!spotifyAvailable()) return null;
  for (let attempt = 0; attempt < 2; attempt++) {
    const token = await getSpotifyToken();
    if (!token) return null;
    try {
      const res = await fetch(`${SPOTIFY_API}${path}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) return await res.json();
      if (res.status === 401 && attempt === 0) {
        cachedToken = null; // expired token — refresh once and retry
        continue;
      }
      if (critical) {
        if (res.status === 429) {
          const retryAfter = Number(res.headers.get('retry-after')) || 30;
          markSpotifyDown('rate limited', retryAfter * 1000);
        } else if (res.status === 403 || res.status >= 500) {
          // Spotify sends this reason as plain text or as { error: { message } }.
          let detail = '';
          try {
            const body = await res.text();
            try {
              detail = JSON.parse(body)?.error?.message ?? body;
            } catch {
              detail = body;
            }
          } catch {}
          detail = detail.slice(0, 120);
          markSpotifyDown(`${res.status} ${detail}`.trim());
        }
      }
      return null;
    } catch (e) {
      if (critical) markSpotifyDown('request failed');
      return null;
    }
  }
  return null;
}

/** Spotify ids are 22-character base62 strings. */
function isSpotifyId(id: string): boolean {
  return /^[0-9A-Za-z]{22}$/.test(id);
}

type SpotifyImage = { url: string; width?: number | null };
function largestImage(images: SpotifyImage[] | undefined): string {
  return images?.[0]?.url ?? '';
}
function smallImage(images: SpotifyImage[] | undefined): string {
  // Spotify lists images largest first (640, 320, 160).
  return images?.find((i) => (i.width ?? 0) > 0 && (i.width ?? 0) <= 320)?.url ?? largestImage(images);
}

function parseSpotifyArtist(item: any): SpotifyArtist {
  return {
    id: item.id,
    name: item.name,
    image: largestImage(item.images),
    thumb: smallImage(item.images),
  };
}

/** Returns null when Spotify couldn't answer (vs [] for "no matches"). */
async function searchSpotifyArtists(query: string, limit: number): Promise<SpotifyArtist[] | null> {
  const data = await spotifyGet(
    `/search?q=${encodeURIComponent(query)}&type=artist&limit=${Math.min(limit, 10)}`
  );
  if (!data) return null;
  return ((data?.artists?.items ?? []) as any[]).map(parseSpotifyArtist);
}

// ─── Deezer ───────────────────────────────────────────────────────────

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
    image: item.picture_big || item.picture_xl || item.picture_medium || '',
    thumb: item.picture_medium || item.picture_big || '',
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

/** Spotify first; Deezer when Spotify can't answer or finds nothing. */
/**
 * Spotify only. Deezer is used for the whole request solely when Spotify
 * fails outright (refused, cooling down, unreachable) — never mixed in, and
 * not when Spotify simply finds no matches.
 */
async function findArtists(query: string, limit: number): Promise<SpotifyArtist[]> {
  const spotify = await searchSpotifyArtists(query, limit);
  if (spotify !== null) return spotify;
  return searchDeezerArtists(query, limit);
}

/**
 * Curated "top artists" list, refreshed live (names + images) from Spotify,
 * or Deezer when Spotify is unavailable. Falls back to the static list if
 * neither can be reached.
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
    queries.map(async (name) => (await findArtists(name, 1))[0] ?? null)
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

  const live = await findArtists(q, limit);
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
  deezerPreview?: string;
}

/**
 * Collects candidate tracks for a Spotify artist, deduped by title: top
 * tracks, then album/single tracks, then paged track search (the search
 * endpoint keeps working when top-tracks/albums are restricted for an app).
 */
async function collectSpotifyCandidates(
  artistId: string,
  artistName: string,
  cap = 40
): Promise<DeezerCandidate[]> {
  const byName = new Map<string, DeezerCandidate>();
  const push = (items: any[], fallbackArt = '', requireArtist = false) => {
    for (const t of items) {
      if (byName.size >= cap) return;
      if (!t?.id || !t?.name) continue;
      if (requireArtist && !(t?.artists ?? []).some((a: any) => a?.id === artistId)) continue;
      const key = baseTitle(t.name); // "Song" and "Song (Remix)" = one song
      if (!key || byName.has(key)) continue;
      byName.set(key, {
        id: t.id,
        name: t.name,
        albumArtUrl: largestImage(t?.album?.images) || fallbackArt,
      });
    }
  };

  // 1. Top tracks (optional endpoint — may be restricted)
  const top = await spotifyGet(`/artists/${artistId}/top-tracks?market=US`, false);
  push(top?.tracks ?? []);

  // 2. Albums + singles. Development-mode apps get 400 "Invalid limit" above
  //    10 albums per page, so page through 10 at a time (max 3 pages).
  for (let page = 0; page < 3 && byName.size < cap; page++) {
    const albums = await spotifyGet(
      `/artists/${artistId}/albums?include_groups=album,single&market=US&limit=10&offset=${page * 10}`,
      false
    );
    const items: any[] = albums?.items ?? [];
    for (const album of items) {
      if (byName.size >= cap) break;
      const tracks = await spotifyGet(`/albums/${album.id}/tracks?market=US&limit=50`, false);
      push(tracks?.items ?? [], largestImage(album?.images), true);
    }
    if (items.length < 10) break;
  }

  // 3. Paged search fallback
  for (const q of [`artist:"${artistName}"`, artistName]) {
    let offset = 0;
    while (byName.size < cap && offset < cap * 4) {
      const data = await spotifyGet(
        `/search?q=${encodeURIComponent(q)}&type=track&limit=10&offset=${offset}&market=US`
      );
      const items: any[] = data?.tracks?.items ?? [];
      if (items.length === 0) break;
      push(items, '', true);
      offset += 10;
    }
  }

  return Array.from(byName.values()).slice(0, cap);
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
      const key = baseTitle(name);
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
    const key = baseTitle(r.trackName);
    if (key && !byName.has(key)) byName.set(key, r.previewUrl);
  }
  return byName;
}

/** Exact base-title lookup only; no fuzzy fallback (see sameTrackName). */
function findItunesPreview(previews: Map<string, string>, trackName: string): string | null {
  return previews.get(baseTitle(trackName)) ?? null;
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
 * A title without decorations that vary between catalogs:
 * "DOMINOS (feat. Talha Anjum)" → "dominos", "Song - Remastered 2011" →
 * "song", "Track [Live]" → "track".
 */
function baseTitle(value: string): string {
  const stripped = normalizeName(
    value
      .replace(/\s*[([][^)\]]*[)\]]/g, ' ')
      .replace(/\s+-\s+.*$/, ' ')
      .replace(/\s+(feat\.?|ft\.?|featuring)\s+.*$/i, ' ')
  );
  return stripped || normalizeName(value);
}

/**
 * Same song title? Exact match on the base title only. (It used to accept
 * either title *containing* the other, so a song called "U" matched every
 * title with a "u" in it and its clip played for unrelated rounds.)
 */
function sameTrackName(query: string, candidate: string): boolean {
  const q = baseTitle(query);
  return !!q && q === baseTitle(candidate);
}

/** Each artist in a credit like "Shareh, AHSAN & Umair" or "A feat. B". */
function artistCredits(value: string): string[] {
  return value
    .split(/\s*(?:,|&|\+|\/|;|\s+x\s+|\s+and\s+|\bfeat\.?|\bft\.?|\bfeaturing\b|\bwith\b|\bvs\.?)\s*/i)
    .map(normalizeName)
    .filter(Boolean);
}

/**
 * Is `artist` credited on `credit`? Exactly one of the credited names, or
 * the whole credit, must equal it — "Umair Bin Abdullah" is not "Umair".
 */
function sameArtistName(artist: string, credit: string): boolean {
  const a = normalizeName(artist);
  if (!a) return false;
  return normalizeName(credit) === a || artistCredits(credit).includes(a);
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
  trackName: string,
  useItunes = true
): Promise<ResolvedPreview | null> {
  // 1. iTunes (rate limited ~20/min, so callers can skip it)
  if (useItunes) try {
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
    const cap = limit * 6;
    const itunesPromise = fetchItunesPreviews(artistName);

    // Fetch a wide slice of the catalog so we have plenty of same-artist names
    // to draw alternatives from after the playable pool is filled.
    // 1. Spotify, when this is a Spotify artist and Spotify is answering.
    let candidates: DeezerCandidate[] = [];
    if (isSpotifyId(artistId) && spotifyAvailable()) {
      candidates = shuffle(await collectSpotifyCandidates(artistId, artistName, cap));
    }

    const itunes = await itunesPromise;
    const tracks: TrackPoolItem[] = [];
    const chosen = new Set<string>();

    // Per-track iTunes lookups are rate limited, so cap them; after that,
    // Deezer (own preview, then a Deezer search) is the fallback.
    let itunesLookupsLeft = 8;
    const usedPreviews = new Set<string>();
    const fill = async (list: DeezerCandidate[]) => {
      for (const track of list) {
        if (tracks.length >= limit) break;
        let preview: ResolvedPreview | null = null;
        const bulk = findItunesPreview(itunes, track.name);
        if (bulk) {
          preview = { url: bulk, source: 'itunes', durationMs: 30000 };
        } else {
          const useItunes = itunesLookupsLeft > 0;
          if (useItunes) itunesLookupsLeft--;
          if (track.deezerPreview && !useItunes) {
            preview = { url: track.deezerPreview, source: 'deezer', durationMs: 30000 };
          } else {
            preview = await resolvePreview(artistName, track.name, useItunes);
          }
          if (!preview && track.deezerPreview) {
            preview = { url: track.deezerPreview, source: 'deezer', durationMs: 30000 };
          }
        }
        if (!preview) continue;
        // Every round must have its own clip.
        if (usedPreviews.has(preview.url)) continue;
        usedPreviews.add(preview.url);

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
    };

    // One source per room, never mixed: if Spotify produced any songs, the
    // room uses only those. Deezer builds the list only for a Deezer artist,
    // or when Spotify failed outright and returned nothing.
    if (candidates.length === 0) {
      const deezerId = await resolveDeezerArtistId(artistId, artistName);
      if (deezerId) {
        candidates = shuffle(await collectCandidates(deezerId, cap));
      }
    }
    await fill(candidates);

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