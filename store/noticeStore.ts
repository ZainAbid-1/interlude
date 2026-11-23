import { create } from 'zustand';
import type { ComponentProps } from 'react';
import type { Ionicons } from '@expo/vector-icons';

/**
 * One queue for every in-app message, so they look the same everywhere,
 * show one at a time, and never pile up on top of each other.
 *
 *   notify.success('Code copied')
 *   notify.error("Couldn't join", 'That room is closed', { label: 'Try again', onPress: retry })
 *   if (await confirm({ title: 'Remove Ali?', confirmLabel: 'Remove', destructive: true })) ...
 */

export type NoticeKind = 'success' | 'info' | 'error';
type IconName = ComponentProps<typeof Ionicons>['name'];

export interface NoticeAction {
  label: string;
  onPress: () => void;
}

export interface Notice {
  id: number;
  kind: NoticeKind;
  title: string;
  message?: string;
  icon?: IconName;
  /** Shows a player's photo instead of the icon (friend events). */
  avatar?: { uri?: string | null; name: string };
  action?: NoticeAction;
  /** ms before it hides itself; 0 = stays until closed. */
  duration: number;
}

export interface ConfirmOptions {
  title: string;
  message?: string;
  confirmLabel: string;
  cancelLabel?: string;
  /** Red button: for actions that remove or end something. */
  destructive?: boolean;
  icon?: IconName;
}

interface PendingConfirm extends ConfirmOptions {
  id: number;
  resolve: (ok: boolean) => void;
}

interface NoticeState {
  queue: Notice[];
  dialog: PendingConfirm | null;
  push: (n: Omit<Notice, 'id' | 'duration'> & { duration?: number }) => number;
  dismiss: (id: number) => void;
  answer: (ok: boolean) => void;
}

let nextId = 1;
const MAX_QUEUE = 4;

/** Short messages hide on their own; errors wait, because they need reading. */
function defaultDuration(kind: NoticeKind, hasAction: boolean, hasMessage: boolean) {
  if (kind === 'error') return 0;
  if (hasAction) return 6000;
  return hasMessage ? 4000 : 2800;
}

export const useNoticeStore = create<NoticeState>((set, get) => ({
  queue: [],
  dialog: null,

  push: (n) => {
    const id = nextId++;
    const notice: Notice = {
      ...n,
      id,
      duration: n.duration ?? defaultDuration(n.kind, !!n.action, !!n.message),
    };
    // The same message twice in a row (a double tap) only shows once.
    const q = get().queue.filter((x) => !(x.title === n.title && x.message === n.message));
    set({ queue: [...q, notice].slice(-MAX_QUEUE) });
    return id;
  },

  dismiss: (id) => set({ queue: get().queue.filter((n) => n.id !== id) }),

  answer: (ok) => {
    const d = get().dialog;
    if (!d) return;
    set({ dialog: null });
    d.resolve(ok);
  },
}));

type Extra = Partial<Pick<Notice, 'icon' | 'avatar' | 'action' | 'duration'>>;

export const notify = {
  success: (title: string, message?: string, extra?: Extra) =>
    useNoticeStore.getState().push({ kind: 'success', title, message, ...extra }),
  info: (title: string, message?: string, extra?: Extra) =>
    useNoticeStore.getState().push({ kind: 'info', title, message, ...extra }),
  error: (title: string, message?: string, extra?: Extra) =>
    useNoticeStore.getState().push({ kind: 'error', title, message, ...extra }),
};

/** Asks a yes/no question in the app's own style. Resolves true on confirm. */
export function confirm(options: ConfirmOptions): Promise<boolean> {
  return new Promise((resolve) => {
    // A newer question replaces an unanswered one (counts as "no").
    useNoticeStore.getState().dialog?.resolve(false);
    useNoticeStore.setState({ dialog: { ...options, id: nextId++, resolve } });
  });
}
