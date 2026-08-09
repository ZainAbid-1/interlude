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