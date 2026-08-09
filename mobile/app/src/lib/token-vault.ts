import * as SecureStore from "expo-secure-store";

import type { SessionTokens } from "./auth-helpers";

const SESSION_KEY = "vorinthex.auth.session.v1";
let operation = Promise.resolve<unknown>(undefined);
let generation = 0;

function serialize<T>(work: () => Promise<T>): Promise<T> {
  const next = operation.then(work, work);
  operation = next.catch(() => undefined);
  return next;
}

function isSession(value: unknown): value is SessionTokens {
  if (!value || typeof value !== "object") return false;
  const session = value as Partial<SessionTokens>;
  return typeof session.accessToken === "string" &&
    typeof session.refreshToken === "string" &&
    typeof session.accessExpiresAt === "number" &&
    typeof session.refreshExpiresAt === "number";
}

async function readUnsafe() {
  const raw = await SecureStore.getItemAsync(SESSION_KEY);
  if (!raw) return { invalidated: false, session: null };
  try {
    const session: unknown = JSON.parse(raw);
    if (isSession(session) && session.refreshExpiresAt > Date.now()) return { invalidated: false, session };
  } catch {
    // Corrupt or obsolete entries are removed below.
  }
  generation += 1;
  await SecureStore.deleteItemAsync(SESSION_KEY);
  return { invalidated: true, session: null };
}

export const tokenVault = {
  read: () => serialize(async () => (await readUnsafe()).session),
  snapshot: () => serialize(async () => ({ ...await readUnsafe(), generation })),
  writeIfCurrent: (session: SessionTokens, expectedGeneration: number) => serialize(async () => {
    if (generation !== expectedGeneration) return false;
    await SecureStore.setItemAsync(
      SESSION_KEY,
      JSON.stringify(session),
      { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY },
    );
    generation += 1;
    return true;
  }),
  clear: () => {
    generation += 1;
    return serialize(() => SecureStore.deleteItemAsync(SESSION_KEY));
  },
  clearIfCurrent: (expectedGeneration: number) => {
    if (generation !== expectedGeneration) return Promise.resolve(false);
    generation += 1;
    return serialize(async () => {
      await SecureStore.deleteItemAsync(SESSION_KEY);
      return true;
    });
  },
};
