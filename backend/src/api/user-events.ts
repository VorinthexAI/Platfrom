import { z } from 'zod';
import { getUserByEmailHash, getUserById, updateUser } from '@/lib/db/users.node';
import { insertEvent } from '@/lib/db/events.node';
import { newId } from '@/lib/ids';
import { NEXUS_SCOPE_KEY } from '@/lib/ai/scopes';
import { strictObject } from './validation';

const emailHashSchema = z.string().regex(/^[a-f0-9]{64}$/);
export const userEventSlugSchema = z.string().min(1).max(200);

export const userEventSchema = strictObject({
  distinctId: z.string().min(1).optional(),
  slug: userEventSlugSchema,
  payload: z.record(z.unknown()).default({}),
  createdAt: z.string().optional(),
});

export const postUserEventsBodySchema = strictObject({
  email_hash: emailHashSchema.optional(),
  events: z.array(userEventSchema).min(1),
});

export type UserEvent = z.infer<typeof userEventSchema>;

interface AppendUserEventsDeps {
  getUserByEmailHash: typeof getUserByEmailHash;
  getUserById: typeof getUserById;
  insertEvent: typeof insertEvent;
  newId: typeof newId;
  updateUser: typeof updateUser;
}

const defaultDeps: AppendUserEventsDeps = {
  getUserByEmailHash,
  getUserById,
  insertEvent,
  newId,
  updateUser,
};

export async function appendUserEvents(
  input: { userId?: string; emailHash?: string; events: UserEvent[] },
  deps: AppendUserEventsDeps = defaultDeps,
) {
  if (!input.userId && !input.emailHash) {
    return null;
  }

  const user = input.userId
    ? await deps.getUserById(input.userId)
    : input.emailHash
      ? await deps.getUserByEmailHash(input.emailHash)
      : null;
  if (!user) return null;

  const now = new Date().toISOString();
  for (const event of input.events) {
    await deps.insertEvent({
      key: deps.newId(),
      scopeId: NEXUS_SCOPE_KEY,
      userId: user.key,
      slug: event.slug,
      data: {
        distinctId: event.distinctId ?? null,
        payload: event.payload,
      },
      createdAt: event.createdAt ?? now,
    });
  }
  await deps.updateUser(user.key, { updatedAt: now });
  return { id: user.key, insertedCount: input.events.length };
}
