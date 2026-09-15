import { z } from 'zod';
import { sha256, timingSafeEqual } from '@/lib/crypto';
import { agentGreetingOccasionSchema } from '@/lib/ai/agents/greeting';
import { guideModeSchema, guideTopicSchema } from './schemas';

const TOKEN_LIFETIME_MS = 24 * 60 * 60 * 1_000;
const tokenGuideTopicsSchema = z.union([
  z.object({ status: z.literal('NONE') }).strict(),
  z.object({ status: z.literal('READY'), topics: z.array(guideTopicSchema).length(3).refine((topics) => new Set(topics.map(({ key }) => key)).size === topics.length && new Set(topics.map(({ label }) => label.toLocaleLowerCase())).size === topics.length && new Set(topics.map(({ question }) => question.toLocaleLowerCase())).size === topics.length, 'Guide topics must be unique.') }).strict(),
]);

export const openingGreetingSnapshotSchema = z.object({
  version: z.literal(1),
  key: z.string().cuid(),
  teamKey: z.string().trim().min(1).max(160),
  scopeKey: z.string().cuid(),
  userKey: z.string().cuid(),
  occasion: agentGreetingOccasionSchema,
  greetingState: z.enum(['referral-onboarding', 'new-account', 'returning']),
  message: z.string().trim().min(1).max(500),
  guideTopicMode: guideModeSchema,
  guideTopics: tokenGuideTopicsSchema,
  createdAt: z.string().datetime(),
  expiresAt: z.number().int().positive(),
}).strict();
export type OpeningGreetingSnapshot = z.infer<typeof openingGreetingSnapshotSchema>;

function secret() {
  const value = process.env.ACCESS_TOKEN_SECRET;
  if (!value) throw new Error('ACCESS_TOKEN_SECRET is required');
  return value;
}

async function signature(payload: string, tokenSecret: string) {
  return sha256(`conversation-opening-greeting.${payload}.${tokenSecret}`);
}

export async function issueOpeningGreetingToken(input: Omit<OpeningGreetingSnapshot, 'version' | 'expiresAt'>, currentTime = Date.now(), tokenSecret = secret()) {
  const snapshot = openingGreetingSnapshotSchema.parse({ ...input, version: 1, expiresAt: currentTime + TOKEN_LIFETIME_MS });
  const payload = Buffer.from(JSON.stringify(snapshot)).toString('base64url');
  return `${payload}.${await signature(payload, tokenSecret)}`;
}

export async function verifyOpeningGreetingToken(token: string, currentTime = Date.now(), tokenSecret = secret()) {
  const [payload, suppliedSignature, extra] = token.split('.');
  if (!payload || !suppliedSignature || extra || !timingSafeEqual(suppliedSignature, await signature(payload, tokenSecret))) return null;
  try {
    const snapshot = openingGreetingSnapshotSchema.parse(JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')));
    return snapshot.expiresAt > currentTime ? snapshot : null;
  } catch {
    return null;
  }
}
