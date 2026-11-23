import { router } from 'expo-router';
import { supabase } from '../lib/supabase';
import { readActiveMatch, clearActiveMatch } from './activeMatch';
import { useGameStore } from '../store/gameStore';
import { useRoomStore } from '../store/roomStore';
import { confirm, notify } from '../store/noticeStore';

let offeredFor: string | null = null;

/**
 * The app was closed or crashed mid-match: offer to jump back in while the
 * match is still on (the opponent can claim the win after about a minute).
 */
export async function offerRejoin() {
  if (!supabase || useGameStore.getState().roomId) return;
  const saved = await readActiveMatch();
  if (!saved || offeredFor === saved.roomId) return;
  offeredFor = saved.roomId;

  const me = (await supabase.auth.getUser()).data.user?.id;
  const { data: room } = await supabase
    .from('rooms')
    .select('status, forfeit_by')
    .eq('id', saved.roomId)
    .maybeSingle();

  if (!room || room.status !== 'active' || room.forfeit_by) {
    await clearActiveMatch();
    if (room?.forfeit_by && room.forfeit_by === me) {
      notify.info(
        'Your last match ended',
        'You were away for over a minute, so it counted as a loss.',
        { icon: 'timer-outline' }
      );
    }
    return;
  }

  const yes = await confirm({
    title: 'Your match is still on',
    message: `${saved.artistName ? `${saved.artistName}. ` : ''}Jump back in now. If you don't, your opponent wins in about a minute.`,
    confirmLabel: 'Rejoin match',
    cancelLabel: 'Not now',
    icon: 'play-circle-outline',
  });
  if (!yes) return;

  const res = await useRoomStore.getState().resumeRoom(saved.roomId);
  if (!res.ok) {
    await clearActiveMatch();
    notify.info("Couldn't rejoin", res.error);
    return;
  }
  router.push('/game');
}
