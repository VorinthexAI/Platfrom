import { z } from 'zod';
import { sha256 } from '@/lib/crypto';
import { createNodeHelpers, isArangoUniqueConstraintError } from './base';
import { eventIdentifierSchema } from '@/lib/ai/events/event-identifier';

export const NEWCOMER_GRANT_CLAIMS_COLLECTION = 'newcomerGrantClaims';

export const newcomerGrantClaimSchema = z.object({
  key: z.string().regex(/^[a-f0-9]{64}$/),
  userKey: z.string().trim().min(1).max(200),
  grantVersion: z.literal('v2'),
  createdAt: z.string().datetime(),
}).strict();

export type NewcomerGrantClaim = z.infer<typeof newcomerGrantClaimSchema>;

const helpers = createNodeHelpers(NEWCOMER_GRANT_CLAIMS_COLLECTION, newcomerGrantClaimSchema, [], { requireEmbedding: false });

export async function newcomerGrantClaimKey(installationIdentifier: string) {
  return sha256(eventIdentifierSchema.parse(installationIdentifier));
}

export async function claimNewcomerGrant(installationIdentifier: string, userKey: string, createdAt = new Date().toISOString()): Promise<'claimed' | 'duplicate'> {
  const key = await newcomerGrantClaimKey(installationIdentifier);
  try {
    await helpers.insert({ key, userKey, grantVersion: 'v2', createdAt });
    return 'claimed';
  } catch (error) {
    if (!isArangoUniqueConstraintError(error)) throw error;
    return 'duplicate';
  }
}

export async function releaseNewcomerGrantClaim(installationIdentifier: string) {
  try {
    await helpers.deleteById(await newcomerGrantClaimKey(installationIdentifier));
  } catch {
    return;
  }
}
