import { create } from 'zustand';

type RoomStatus = 'idle' | 'waiting' | 'ready' | 'active' | 'completed';

interface RoomState {
  // Room info
  roomCode: string;
  roomStatus: RoomStatus;
  hostName: string;
  guestName: string | null;
  artistName: string;
  artistImage: string;

  // Readiness
  isHost: boolean;
  isReady: boolean;
  opponentReady: boolean;

  // Actions
  createRoom: (artistName: string, artistImage: string) => void;
  joinRoom: (code: string) => void;
  setReady: () => void;
  startMatch: () => void;
  resetRoom: () => void;
}

function generateRoomCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

export const useRoomStore = create<RoomState>((set, get) => ({
  roomCode: '',
  roomStatus: 'idle',
  hostName: 'You',
  guestName: null,
  artistName: '',
  artistImage: '',
  isHost: false,
  isReady: false,
  opponentReady: false,

  createRoom: (artistName: string, artistImage: string) => {
    set({
      roomCode: generateRoomCode(),
      roomStatus: 'waiting',
      hostName: 'You',
      guestName: null,
      artistName,
      artistImage,
      isHost: true,
      isReady: false,
      opponentReady: false,
    });

    // Simulate guest joining after 2 seconds
    setTimeout(() => {
      set({ guestName: 'Alex', opponentReady: true });
    }, 2000);
  },

  joinRoom: (code: string) => {
    set({
      roomCode: code.toUpperCase(),
      roomStatus: 'waiting',
      hostName: 'Host',
      guestName: 'You',
      isHost: false,
      isReady: false,
      opponentReady: true,
    });
  },

  setReady: () => set({ isReady: true }),

  startMatch: () => set({ roomStatus: 'active' }),

  resetRoom: () =>
    set({
      roomCode: '',
      roomStatus: 'idle',
      hostName: 'You',
      guestName: null,
      artistName: '',
      artistImage: '',
      isHost: false,
      isReady: false,
      opponentReady: false,
    }),
}));
