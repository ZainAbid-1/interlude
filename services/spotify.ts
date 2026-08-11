/**
 * Spotify Web API client (Client Credentials flow).
 * Configure credentials via EXPO_PUBLIC_SPOTIFY_CLIENT_ID and
 * EXPO_PUBLIC_SPOTIFY_CLIENT_SECRET in a .env file.
 *
 * Without credentials every call gracefully falls back to static
 * curated data so the app remains usable in development.
 */

export interface SpotifyArtist {
  id: string;
  name: string;
  image: string;
}

const TOKEN_ENDPOINT = 'https://accounts.spotify.com/api/token';
const API_ENDPOINT = 'https://api.spotify.com/v1';

const CLIENT_ID = (process.env.EXPO_PUBLIC_SPOTIFY_CLIENT_ID ?? '').trim();
const CLIENT_SECRET = (process.env.EXPO_PUBLIC_SPOTIFY_CLIENT_SECRET ?? '').trim();

const hasCredentials = CLIENT_ID.length > 0 && CLIENT_SECRET.length > 0;

let cachedToken: { value: string; expiresAt: number } | null = null;

const BASIC_CHARS =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

function base64Encode(input: string): string {
  let output = '';
  let i = 0;
  const bytes = Array.from(input).map((c) => c.charCodeAt(0) & 0xff);
  while (i < bytes.length) {
    const b1 = bytes[i];
    const b2 = i + 1 < bytes.length ? bytes[i + 1] : NaN;
    const b3 = i + 2 < bytes.length ? bytes[i + 2] : NaN;

    output += BASIC_CHARS[b1 >> 2];
    output += BASIC_CHARS[((b1 & 3) << 4) | (isNaN(b2) ? 0 : b2 >> 4)];

    if (isNaN(b2)) {
      output += '==';
    } else {
      output += BASIC_CHARS[((b2 & 15) << 2) | (isNaN(b3) ? 0 : b3 >> 6)];
      if (isNaN(b3)) {
        output += '=';
      } else {
        output += BASIC_CHARS[b3 & 63];
      }
    }
    i += 3;
  }
  return output;
}

async function getToken(): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now()) {
    return cachedToken.value;
  }

  const response = await fetch(TOKEN_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: `Basic ${base64Encode(`${CLIENT_ID}:${CLIENT_SECRET}`)}`,
    },
    body: 'grant_type=client_credentials',
  });

  const data = await response.json();
  if (!data.access_token) {
    throw new Error('Spotify auth failed');
  }

  const expiresInMs = ((data.expires_in as number) ?? 3600) * 1000;
  cachedToken = {
    value: data.access_token as string,
    expiresAt: Date.now() + expiresInMs - 60 * 1000,
  };
  return cachedToken.value;
}

function pickImage(images: { url: string }[] | undefined): string {
  return images?.[0]?.url ?? '';
}

function parseArtist(item: {
  id: string;
  name: string;
  images?: { url: string }[];
}): SpotifyArtist {
  return {
    id: item.id,
    name: item.name,
    image: pickImage(item.images),
  };
}

/**
 * Curated "top artists" list, refreshed live via the Spotify API.
 * Returns live names + images when credentials are configured,
 * otherwise the static fallback list.
 */
export async function getTopArtists(limit = 6): Promise<SpotifyArtist[]> {
  if (!hasCredentials) {
    return FALLBACK_TOP_ARTISTS.slice(0, limit);
  }

  try {
    const token = await getToken();
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
      queries.map(async (name) => {
        const url = `${API_ENDPOINT}/search?q=${encodeURIComponent(name)}&type=artist&limit=1`;
        const res = await fetch(url, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) return null;
        const data = await res.json();
        const items: any[] = data?.artists?.items ?? [];
        return items[0] ? parseArtist(items[0]) : null;
      })
    );

    const artists = results.filter((a): a is SpotifyArtist => a !== null);
    if (artists.length === 0) {
      return FALLBACK_TOP_ARTISTS.slice(0, limit);
    }
    return artists.slice(0, limit);
  } catch (e) {
    return FALLBACK_TOP_ARTISTS.slice(0, limit);
  }
}

/**
 * Live artist search for the Create Room flow.
 */
export async function searchArtists(
  query: string,
  limit = 6
): Promise<SpotifyArtist[]> {
  const q = query.trim();
  if (!q) return [];

  // Without credentials fall back to filtering the curated list locally.
  if (!hasCredentials) {
    const needle = q.toLowerCase();
    return FALLBACK_TOP_ARTISTS.filter((a) =>
      a.name.toLowerCase().includes(needle)
    ).slice(0, limit);
  }

  try {
    const token = await getToken();
    const url = `${API_ENDPOINT}/search?q=${encodeURIComponent(q)}&type=artist&limit=${limit}`;
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return [];
    const data = await res.json();
    const items: any[] = data?.artists?.items ?? [];
    return items.map((item) => parseArtist(item));
  } catch (e) {
    return [];
  }
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

/**
 * Collects candidate tracks for an artist, deduped by track id.
 * Tries top tracks first, then album/single tracks, and finally falls back
 * to paged search results (the search endpoint keeps working even when the
 * top-tracks/albums endpoints are restricted for a given app/token).
 */
async function collectCandidates(
  token: string,
  artistId: string,
  artistName: string,
  cap = 40
): Promise<TrackCandidate[]> {
  const byId = new Map<string, TrackCandidate>();
  const pushTracks = (items: any[]) => {
    for (const t of items) {
      if (byId.has(t.id)) continue;
      if (byId.size >= cap) return;
      byId.set(t.id, {
        id: t.id,
        name: t.name,
        albumArtUrl: pickImage(t?.album?.images),
      });
    }
  };

  // 1. Artist top tracks
  try {
    const res = await fetch(
      `${API_ENDPOINT}/artists/${artistId}/top-tracks?market=US`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    if (res.ok) {
      const data = await res.json();
      pushTracks(data?.tracks ?? []);
    }
  } catch (e) {
    // continue with album search
  }

  // 2. Albums + singles (up to the cap) to reach a deeper catalog
  try {
    const res = await fetch(
      `${API_ENDPOINT}/artists/${artistId}/albums?include_groups=album,single&market=US&limit=50`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    if (res.ok) {
      const data = await res.json();
      const albums: any[] = data?.items ?? [];
      for (const album of albums) {
        if (byId.size >= cap) break;
        const tracksRes = await fetch(
          `${API_ENDPOINT}/albums/${album.id}/tracks?market=US&limit=20`,
          { headers: { Authorization: `Bearer ${token}` } }
        );
        if (tracksRes.ok) {
          const tracksData = await tracksRes.json();
          pushTracks(tracksData?.items ?? []);
        }
      }
    }
  } catch (e) {
    // best effort
  }

  // 3. Fallback: paged search. Some tokens/apps can't call the
  // top-tracks/albums endpoints (403/400), but search still works.
  if (byId.size < cap) {
    for (const q of [`artist:"${artistName}"`, artistName]) {
      try {
        let offset = 0;
        while (byId.size < cap && offset < cap * 4) {
          const url = `${API_ENDPOINT}/search?q=${encodeURIComponent(q)}&type=track&limit=10&offset=${offset}&market=US`;
          const res = await fetch(url, {
            headers: { Authorization: `Bearer ${token}` },
          });
          if (!res.ok) break;
          const data = await res.json();
          const items: any[] = data?.tracks?.items ?? [];
          if (items.length === 0) break;

          for (const item of items) {
            // Keep only tracks actually credited to the target artist.
            const isTarget = (item?.artists ?? []).some(
              (a: any) => a?.id === artistId
            );
            if (!isTarget || byId.has(item.id)) continue;
            if (byId.size >= cap) break;
            byId.set(item.id, {
              id: item.id,
              name: item.name,
              albumArtUrl: pickImage(item?.album?.images),
            });
          }
          offset += 10;
        }
      } catch (e) {
        // continue with the next search query
      }
    }
  }

  return Array.from(byId.values()).slice(0, cap);
}

/**
 * Resolves a free 3-second-playable preview for a track:
 * iTunes Search API first, Deezer as fallback.
 */
async function resolvePreview(
  artistName: string,
  trackName: string
): Promise<ResolvedPreview | null> {
  // 1. iTunes
  try {
    const term = encodeURIComponent(`${artistName} ${trackName}`);
    const res = await fetch(
      `https://itunes.apple.com/search?term=${term}&entity=song&limit=1`
    );
    if (res.ok) {
      const data = await res.json();
      const result = data?.results?.[0];
      if (result?.previewUrl) {
        return {
          url: result.previewUrl,
          source: 'itunes',
          durationMs: result.trackTimeMillis ?? 30000,
        };
      }
    }
  } catch (e) {
    // fall through to Deezer
  }

  // 2. Deezer
  try {
    const q = encodeURIComponent(`artist:"${artistName}" track:"${trackName}"`);
    const res = await fetch(`https://api.deezer.com/search?q=${q}&limit=1`);
    if (res.ok) {
      const data = await res.json();
      const result = data?.data?.[0];
      if (result?.preview) {
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
  const latest = Math.max(0, durationMs - 3000);
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
 */
export async function getArtistTrackPool(
  artistId: string,
  artistName: string,
  limit = 10
): Promise<TrackPoolItem[]> {
  if (!hasCredentials) return [];

  try {
    const token = await getToken();
    const candidates = shuffle(await collectCandidates(token, artistId, artistName, limit * 5));
    const pool: TrackPoolItem[] = [];

    for (const track of candidates) {
      if (pool.length >= limit) break;
      const preview = await resolvePreview(artistName, track.name);
      if (!preview) continue;
      pool.push({
        spotifyTrackId: track.id,
        trackName: track.name,
        albumArtUrl: track.albumArtUrl,
        previewUrl: preview.url,
        previewSource: preview.source,
        durationMs: preview.durationMs,
        clipStartMs: pickClipStart(preview.durationMs),
      });
    }

    return pool;
  } catch (e) {
    return [];
  }
}