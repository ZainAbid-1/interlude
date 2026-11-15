// Supabase Edge Function: read-only Spotify Web API proxy.
//
// Keeps the Spotify client secret on the server (it used to be bundled in
// the app as EXPO_PUBLIC_SPOTIFY_CLIENT_SECRET, readable by anyone with the
// APK). The app posts { path } and gets back { status, body }.
//
// Secrets (Supabase dashboard → Edge Functions → Secrets, or
// `supabase secrets set ...`):
//   SPOTIFY_CLIENT_ID, SPOTIFY_CLIENT_SECRET
//
// JWT verification stays ON (the default) and the function additionally
// requires a signed-in player's token (the public anon key is refused).

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

/** Only the read-only endpoints the game uses. */
const ALLOWED: RegExp[] = [
  /^\/search\?[^#]*$/,
  /^\/artists\/[0-9A-Za-z]{22}\/top-tracks\?[^#]*$/,
  /^\/artists\/[0-9A-Za-z]{22}\/albums\?[^#]*$/,
  /^\/albums\/[0-9A-Za-z]{22}\/tracks\?[^#]*$/,
];

let token: { value: string; expiresAt: number } | null = null;

async function getToken(): Promise<string | null> {
  if (token && token.expiresAt > Date.now()) return token.value;
  const id = Deno.env.get('SPOTIFY_CLIENT_ID') ?? '';
  const secret = Deno.env.get('SPOTIFY_CLIENT_SECRET') ?? '';
  if (!id || !secret) return null;
  const res = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: `Basic ${btoa(`${id}:${secret}`)}`,
    },
    body: 'grant_type=client_credentials',
  });
  const data = await res.json().catch(() => null);
  if (!data?.access_token) return null;
  token = {
    value: data.access_token,
    expiresAt: Date.now() + ((data.expires_in ?? 3600) - 60) * 1000,
  };
  return token.value;
}

/**
 * Supabase's gateway has already verified the JWT's signature (verify_jwt),
 * but the public anon key is itself a valid JWT with role "anon" and ships
 * in every APK. Require a signed-in player's token (role "authenticated").
 */
function isSignedInPlayer(req: Request): boolean {
  const auth = req.headers.get('authorization') ?? '';
  const token = auth.replace(/^Bearer\s+/i, '');
  const payload = token.split('.')[1];
  if (!payload) return false;
  try {
    const json = JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/')));
    return json?.role === 'authenticated' && typeof json?.sub === 'string';
  } catch {
    return false;
  }
}

function reply(status: number, body: unknown) {
  // Always 200 at the HTTP level; the Spotify status travels in the body so
  // the app can tell "Spotify refused" (cooldown → Deezer) from other errors.
  return new Response(JSON.stringify({ status, body }), {
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return reply(405, { error: 'POST only' });
  if (!isSignedInPlayer(req)) {
    return new Response(JSON.stringify({ error: 'Sign in required' }), {
      status: 401,
      headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  }

  let path = '';
  try {
    path = String((await req.json())?.path ?? '');
  } catch {
    return reply(400, { error: 'Invalid JSON' });
  }
  if (path.length > 500 || !ALLOWED.some((re) => re.test(path))) {
    return reply(400, { error: 'Path not allowed' });
  }

  for (let attempt = 0; attempt < 2; attempt++) {
    const t = await getToken();
    if (!t) return reply(503, { error: 'Spotify is not configured on the server' });
    const res = await fetch(`https://api.spotify.com/v1${path}`, {
      headers: { Authorization: `Bearer ${t}` },
    });
    if (res.status === 401 && attempt === 0) {
      token = null; // expired — refresh once
      continue;
    }
    const text = await res.text();
    let body: unknown = text;
    try {
      body = JSON.parse(text);
    } catch {
      // Spotify sometimes answers in plain text (e.g. the Premium 403).
    }
    const retryAfter = res.headers.get('retry-after');
    return reply(res.status, retryAfter ? { retryAfter: Number(retryAfter), body } : body);
  }
  return reply(502, { error: 'Spotify unavailable' });
});
