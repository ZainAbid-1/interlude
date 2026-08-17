import { create } from 'zustand';
import type { SpotifyArtist } from '../services/spotify';
import { getArtistTrackPool } from '../services/spotify';
import {
  saveTrackPool,
  createRoom as createRoomRow,
  joinRoom as joinRoomRow,
  loadPool,
} from '../services/rooms';
import type { RoomPoolTrack } from '../services/rooms';

type RoomStatus = 'idle' | 'waiting' | 'ready' | 'active' | 'completed';

interface RoomState {
  // Room info
  roomId: string;
  roomCode: string;
  roomStatus: RoomStatus;
  hostName: string;
  guestName: string | null;
  artistName: string;
  artistImage: string;

  // Pool (persisted tracks with previews)
  poolId: string;
  poolTracks: RoomPoolTrack[];

  // Readiness
  isHost: boolean;
  isReady: boolean;
  opponentReady: boolean;

  // Loading / errors
  creatingRoom: boolean;
  joiningRoom: boolean;
  roomError: string | null;

  // Actions (Supabase-backed)
  createRoom: (artist: SpotifyArtist) => Promise<{ ok: boolean; error?: string }>;
  joinRoom: (code: string) => Promise<{ ok: boolean; error?: string }>;
  setReady: () => void;
  startMatch: () => void;
  resetRoom: () => void;
  loadPoolById: (poolId: string) => Promise<{ artist: any; tracks: RoomPoolTrack[] } | null>;
}

export const useRoomStore = create<RoomState>((set, get) => ({
  roomId: '',
  roomCode: '',
  roomStatus: 'idle',
  hostName: 'You',
  guestName: null,
  artistName: '',
  artistImage: '',
  poolId: '',
  poolTracks: [],
  isHost: false,
  isReady: false,
  opponentReady: false,
  creatingRoom: false,
  joiningRoom: false,
  roomError: null,

  createRoom: async (artist) => {
    if (get().creatingRoom) return { ok: false, error: 'Already creating a room' };

    set({ creatingRoom: true, roomError: null });

    // 1. Generate a varied 10-track pool with free previews + a same-artist
    //    catalog of alternative track names for answer options.
    const pool = await getArtistTrackPool(artist.id, artist.name, 10);
    if (pool.tracks.length < 10) {
      set({
        creatingRoom: false,
        roomError: `Only ${pool.tracks.length}/10 tracks have playable previews. Try another artist.`,
      });
      return { ok: false, error: 'Not enough previews for this artist' };
    }

    // 2. Persist pool + option catalog to Supabase
    const saved = await saveTrackPool(artist, pool.tracks, pool.optionNames);
    if ('error' in saved) {
      set({ creatingRoom: false, roomError: saved.error });
      return { ok: false, error: saved.error };
    }

    // 3. Create room with a unique code
    const room = await createRoomRow(saved.poolId);
    if ('error' in room) {
      set({ creatingRoom: false, roomError: room.error });
      return { ok: false, error: room.error };
    }

    set({
      roomId: room.roomId,
      roomCode: room.code,
      roomStatus: 'waiting',
      hostName: 'You',
      guestName: null,
      artistName: artist.name,
      artistImage: artist.image,
      poolId: saved.poolId,
      poolTracks: pool.tracks.map((t, i) => ({
        id: '',
        position: i + 1,
        spotify_track_id: t.spotifyTrackId,
        track_name: t.trackName,
        album_art_url: t.albumArtUrl,
        preview_url: t.previewUrl,
        preview_source: t.previewSource,
        clip_start_ms: t.clipStartMs,
      })),
      isHost: true,
      isReady: false,
      opponentReady: false,
      creatingRoom: false,
    });

    return { ok: true };
  },

  joinRoom: async (code) => {
    if (get().joiningRoom) return { ok: false, error: 'Already joining a room' };

    set({ joiningRoom: true, roomError: null });

    const result = await joinRoomRow(code);
    if ('error' in result) {
      set({ joiningRoom: false, roomError: result.error });
      return { ok: false, error: result.error };
    }

    set({
      roomId: result.room.id,
      roomCode: result.room.code,
      roomStatus: 'waiting',
      hostName: 'Host',
      guestName: 'You',
      artistName: result.artist.name,
      artistImage: result.artist.image,
      poolId: result.room.track_pool_id,
      poolTracks: result.tracks,
      isHost: false,
      isReady: false,
      opponentReady: true,
      joiningRoom: false,
    });

    return { ok: true };
  },

  setReady: () => set({ isReady: true }),

  startMatch: () => set({ roomStatus: 'active' }),

  resetRoom: () =>
    set({
      roomId: '',
      roomCode: '',
      roomStatus: 'idle',
      hostName: 'You',
      guestName: null,
      artistName: '',
      artistImage: '',
      poolId: '',
      poolTracks: [],
      isHost: false,
      isReady: false,
      opponentReady: false,
      creatingRoom: false,
      joiningRoom: false,
      roomError: null,
    }),

  // Reload a room's pool by id (useful on rematch / reconnect)
  loadPoolById: async (poolId: string) => {
    const result = await loadPool(poolId);
    if ('error' in result) return null;
    set({
      artistName: result.artist.name,
      artistImage: result.artist.image,
      poolTracks: result.tracks,
    });
    return result;
  },
}));
