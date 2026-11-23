import { router } from 'expo-router';
import type { GameInvite } from './invites';
import { useInviteStore } from '../store/inviteStore';
import { useGameStore } from '../store/gameStore';
import { useRoomStore } from '../store/roomStore';
import { notify } from '../store/noticeStore';

/**
 * Accepts a friend's challenge and opens their room. Used by the in-app
 * pop-up and by the Join button on a phone notification, so both behave
 * the same way. Returns true when we ended up in the room.
 */
export async function joinChallenge(invite: GameInvite): Promise<boolean> {
  const res = await useInviteStore.getState().respond(invite, true);
  if (res.error || !res.code) {
    notify.error("Couldn't join", res.error ?? 'That room is no longer open.');
    return false;
  }
  // Leave whatever lobby or match we were in, then join like typing the code.
  const game = useGameStore.getState();
  if (game.roomId && !game.gameOver) game.leaveMatch();
  useInviteStore.getState().cancelOutgoing();
  useRoomStore.getState().resetRoom();
  const joined = await useRoomStore.getState().joinRoom(res.code);
  if (!joined.ok) {
    notify.error("Couldn't join", joined.error ?? 'Something went wrong. Try again.');
    return false;
  }
  // Already on the game screen (e.g. our own lobby): the new room id
  // re-initialises it; otherwise this opens it.
  router.navigate('/game');
  return true;
}

export async function declineChallenge(invite: GameInvite) {
  await useInviteStore.getState().respond(invite, false);
}
