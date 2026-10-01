import { z } from 'zod';
import { sha256, timingSafeEqual } from '@/lib/crypto';

const TOKEN_LIFETIME_MS = 24 * 60 * 60 * 1_000;

export const conversationContextSeedSnapshotSchema = z.object({
  version: z.literal(1),
  key: z.string().cuid(),
  teamKey: z.string().trim().min(1).max(160),
  scopeKey: z.string().cuid(),
  userKey: z.string().cuid(),
  message: z.string().trim().min(1).max(4_000),
  conversationKeys: z.array(z.string().cuid()).min(1).max(20),
  createdAt: z.string().datetime(),
  expiresAt: z.number().int().positive(),
}).strict();
export type ConversationContextSeedSnapshot = z.infer<typeof conversationContextSeedSnapshotSchema>;

function secret() {
  const value = process.env.ACCESS_TOKEN_SECRET;
  if (!value) throw new Error('ACCESS_TOKEN_SECRET is required');
  return value;
}

async function signature(payload: string, tokenSecret: string) {
  return sha256(`conversation-context-seed.${payload}.${tokenSecret}`);
}

export async function issueConversationContextSeedToken(input: Omit<ConversationContextSeedSnapshot, 'version' | 'expiresAt'>, currentTime = Date.now(), tokenSecret = secret()) {
  const snapshot = conversationContextSeedSnapshotSchema.parse({ ...input, version: 1, expiresAt: currentTime + TOKEN_LIFETIME_MS });
  const payload = Buffer.from(JSON.stringify(snapshot)).toString('base64url');
  return `${payload}.${await signature(payload, tokenSecret)}`;
}

export async function verifyConversationContextSeedToken(token: string, currentTime = Date.now(), tokenSecret = secret()) {
  const [payload, suppliedSignature, extra] = token.split('.');
  if (!payload || !suppliedSignature || extra || !timingSafeEqual(suppliedSignature, await signature(payload, tokenSecret))) return null;
  try {
    const snapshot = conversationContextSeedSnapshotSchema.parse(JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')));
    return snapshot.expiresAt > currentTime ? snapshot : null;
  } catch {
    return null;
  }
}
