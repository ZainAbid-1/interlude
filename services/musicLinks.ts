/**
 * Credits and "listen on" links for the songs in a match.
 *
 * Every revealed song links back to where it can be streamed properly
 * (Spotify's developer policy requires a link back for any metadata shown),
 * and every preview is credited to its source (Apple asks previews to be
 * marked as "courtesy of iTunes").
 */

export interface SongRef {
  spotify_track_id?: string | null;
  track_name: string;
  preview_source?: 'itunes' | 'deezer' | string | null;
}

/** Spotify track ids are 22 letters/digits; Deezer ids are all digits. */
const isSpotifyId = (id?: string | null) => !!id && /^[A-Za-z0-9]{22}$/.test(id);
const isDeezerId = (id?: string | null) => !!id && /^\d+$/.test(id);

export function songLinks(song: SongRef, artistName: string) {
  const query = encodeURIComponent(`${song.track_name} ${artistName}`.trim());
  const id = song.spotify_track_id;
  return {
    spotify: isSpotifyId(id)
      ? `https://open.spotify.com/track/${id}`
      : `https://open.spotify.com/search/${query}`,
    appleMusic: `https://music.apple.com/search?term=${query}`,
    deezer: isDeezerId(id) ? `https://www.deezer.com/track/${id}` : null,
  };
}

/** Where the clip came from, shown under the song. */
export function previewCredit(song: SongRef): string {
  return song.preview_source === 'deezer' ? 'Preview from Deezer' : 'Preview courtesy of iTunes';
}

/** Shown once wherever songs appear: Interlude is not affiliated with anyone. */
export const NOT_AFFILIATED =
  'Interlude is an independent fan-made game and is not affiliated with, endorsed or sponsored by any artist, record label, Spotify, Apple or Deezer. Song info from Spotify; previews from iTunes and Deezer. All music belongs to its owners.';

export const CONTACT_EMAIL = 'Zainabid7272@gmail.com';
export const PRIVACY_POLICY_URL = 'https://github.com/ZainAbid-1/interlude/blob/main/docs/privacy-policy.md';
export const ACCOUNT_DELETION_URL = 'https://github.com/ZainAbid-1/interlude/blob/main/docs/delete-account.md';
