/**
 * This phone's push address, kept apart from services/push.ts so the auth
 * store can forget it on log out without pulling in the whole game.
 */
let token: string | null = null;

export function setPushToken(value: string | null) {
  token = value;
}

/** Returns the address and forgets it. */
export function takePushToken(): string | null {
  const t = token;
  token = null;
  return t;
}
