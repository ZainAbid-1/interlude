/**
 * Mock data for a Radiohead game session.
 * Used to demo the frontend without backend.
 */

export interface MockTrack {
  id: string;
  trackName: string;
  albumArt: string;
  previewUrl: string;
}

export interface MockRound {
  roundIndex: number;
  track: MockTrack;
  options: string[];
  correctAnswer: string;
}

export interface MockGameSession {
  artistName: string;
  artistImage: string;
  rounds: MockRound[];
}

const RADIOHEAD_SONGS = [
  'Creep',
  'Karma Police',
  'No Surprises',
  'High and Dry',
  'Paranoid Android',
  'Exit Music (For a Film)',
  'Lucky',
  'Fake Plastic Trees',
  'Street Spirit (Fade Out)',
  'Everything In Its Right Place',
  'Idioteque',
  'How to Disappear Completely',
  'Just',
  'The Bends',
  'Let Down',
  'Airbag',
  'Optimistic',
  'There, There',
  'Pyramid Song',
  '2 + 2 = 5',
];

function getDistractors(correctAnswer: string, count: number = 3): string[] {
  const available = RADIOHEAD_SONGS.filter((s) => s !== correctAnswer);
  const shuffled = [...available].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, count);
}

function shuffleArray<T>(arr: T[]): T[] {
  const result = [...arr];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

export const MOCK_GAME_SESSION: MockGameSession = {
  artistName: 'Radiohead',
  artistImage:
    'https://i.scdn.co/image/ab6761610000e5eba03696716c9ee605006047fd',
  rounds: RADIOHEAD_SONGS.slice(0, 10).map((song, index) => {
    const distractors = getDistractors(song);
    return {
      roundIndex: index + 1,
      track: {
        id: `track-${index + 1}`,
        trackName: song,
        albumArt:
          'https://i.scdn.co/image/ab67616d0000b273c8b444df094c181e82df060c',
        previewUrl: '',
      },
      options: shuffleArray([song, ...distractors]),
      correctAnswer: song,
    };
  }),
};

export const MOCK_ROOM = {
  code: 'RHXQ42',
  hostName: 'You',
  guestName: 'Alex',
  hostAvatar: '🎵',
  guestAvatar: '🎸',
  status: 'active' as const,
};
