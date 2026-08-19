import { createHash, createHmac, randomBytes, scrypt as nodeScrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { z } from 'zod';
import { newId } from '@/lib/ids';
import { collectionImageSchema } from '@/lib/db/collection-images.node';
import { collectionInviteSchema, type CollectionInvite } from '@/lib/db/collection-invites.node';
import { tagAssignmentSchema } from '@/lib/db/tag-assignments.node';
import { shareSchema } from '@/lib/db/shares.node';
import { decryptAuthenticatedJson, encryptAuthenticatedJson, orchestrationMasterKey } from '@/lib/authenticated-encryption';
import { getDefaultMediaLibraryRepository, type MediaLibraryRepository } from './repository';

const key = z.string().cuid();
const timestamp = z.string().datetime();
const relationInputSchema = z.object({ scopeKey: key, collectionKey: key, imageKey: key, actorKey: key, now: timestamp }).strict();
const moveInputSchema = relationInputSchema.extend({ sourceCollectionKey: key }).strict();
const leaveInputSchema = z.object({ scopeKey: key, collectionKey: key, actorKey: key }).strict();
const idempotencyKey = z.string().trim().min(1).max(200);
const inviteInputSchema = z.object({ scopeKey: key, collectionKey: key, invitedByKey: key, inviteeKey: key.optional(), email: z.string().trim().toLowerCase().email().optional(), role: z.enum(['collaborator', 'viewer']).default('collaborator'), expiresAt: timestamp.optional(), now: timestamp, idempotencyKey }).strict().refine((value) => (value.inviteeKey === undefined) !== (value.email === undefined), 'Exactly one recipient is required');
const acceptInviteInputSchema = z.object({ token: z.string().min(32).max(512), recipientKey: key, now: timestamp }).strict();
const assignmentInputSchema = z.object({ scopeKey: key, tagKey: key, sourceType: z.enum(['document', 'image', 'collection', 'place']), sourceKey: key, actorKey: key, source: z.enum(['user', 'ai']), now: timestamp }).strict();
const coverInputSchema = z.object({ scopeKey: key, collectionKey: key, imageKey: key, ownerKey: key, now: timestamp }).strict();
const shareInputSchema = z.preprocess((raw) => raw && typeof raw === 'object' && !Array.isArray(raw) && !('permission' in raw) ? { ...raw, permission: (raw as { sourceType?: unknown }).sourceType === 'collection' ? 'viewer' : 'read' } : raw, z.object({ scopeKey: key, sourceType: z.enum(['image', 'collection', 'place']), sourceKey: key, ownerKey: key, permission: z.enum(['read', 'comment', 'viewer', 'collaborator']), expiresAt: timestamp.optional(), password: z.string().min(1).max(256).optional(), now: timestamp, idempotencyKey }).strict().superRefine((value, context) => {
  const allowed = value.sourceType === 'collection' ? ['viewer', 'collaborator'] : ['read', 'comment'];
  if (!allowed.includes(value.permission)) context.addIssue({ code: z.ZodIssueCode.custom, path: ['permission'], message: 'Share permission is invalid for this source type.' });
}));
const accessShareInputSchema = z.object({ token: z.string().min(32).max(512), password: z.string().min(1).max(256).optional(), at: timestamp }).strict();

export class MediaLibraryAccessError extends Error { constructor(message: string) { super(message); this.name = 'MediaLibraryAccessError'; } }
export interface MediaLibraryServiceDependencies { repository?: MediaLibraryRepository; newId?: () => string; token?: () => string; hashPassword?: (password: string) => Promise<string>; verifyPassword?: (password: string, passwordHash: string) => Promise<boolean>; encryptReplay?: (value: unknown) => string; decryptReplay?: (value: string) => unknown; requestFingerprint?: (value: string) => string; }
const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');
const scrypt = promisify(nodeScrypt);
export async function hashMediaLibrarySharePassword(password: string): Promise<string> { const salt = randomBytes(16); const derived = await scrypt(password, salt, 32) as Buffer; return `scrypt:${salt.toString('hex')}:${derived.toString('hex')}`; }
export async function verifyMediaLibrarySharePassword(password: string, passwordHash: string): Promise<boolean> {
  const match = /^scrypt:([a-f0-9]{32}):([a-f0-9]{64})$/.exec(passwordHash);
  if (!match) return false;
  const expected = Buffer.from(match[2]!, 'hex');
  const actual = await scrypt(password, Buffer.from(match[1]!, 'hex'), expected.length) as Buffer;
  return timingSafeEqual(actual, expected);
}
export function mediaLibraryRequestFingerprint(value: string, masterKey = orchestrationMasterKey()): string { return createHmac('sha256', masterKey).update(value).digest('hex'); }
function withoutSecrets<T extends Record<string, unknown>>(value: T): Omit<T, 'tokenHash' | 'passwordHash'> { const { tokenHash: _tokenHash, passwordHash: _passwordHash, ...safe } = value; return safe; }
async function retryIdempotentWrite<T>(operation: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt += 1) {
    try { return await operation(); }
    catch (error) {
      const conflict = error && typeof error === 'object' && (('errorNum' in error && error.errorNum === 1200) || ('code' in error && error.code === 409));
      if (!conflict || attempt >= 4) throw error;
      await Bun.sleep(5 * (attempt + 1));
    }
  }
}

export function createMediaLibraryService(dependencies: MediaLibraryServiceDependencies = {}) {
  const repository = dependencies.repository ?? getDefaultMediaLibraryRepository();
  const id = dependencies.newId ?? newId;
  const issueToken = dependencies.token ?? (() => randomBytes(32).toString('base64url'));
  const derivePasswordHash = dependencies.hashPassword ?? hashMediaLibrarySharePassword;
  const verifyPassword = dependencies.verifyPassword ?? verifyMediaLibrarySharePassword;
  const encryptReplay = dependencies.encryptReplay ?? encryptAuthenticatedJson;
  const decryptReplay = dependencies.decryptReplay ?? decryptAuthenticatedJson;
  const requestFingerprint = dependencies.requestFingerprint ?? mediaLibraryRequestFingerprint;
  const requestIdentity = (operation: string, scopeKey: string, actorKey: string, requestKey: string) => `c${sha256(`${operation}\0${scopeKey}\0${actorKey}\0${requestKey}`).slice(0, 24)}`;
  const relation = (input: z.infer<typeof relationInputSchema>) => collectionImageSchema.parse({ key: id(), scopeKey: input.scopeKey, collectionKey: input.collectionKey, imageKey: input.imageKey, addedByKey: input.actorKey, createdAt: input.now });
  return {
    async addImageToCollection(raw: unknown) { const input = relationInputSchema.parse(raw); if (!await repository.canAccessImage(input.scopeKey, input.imageKey, input.actorKey)) throw new MediaLibraryAccessError('Source image access required'); return repository.addImageToCollection(relation(input)); },
    async copyImageToCollection(raw: unknown) { const input = relationInputSchema.parse(raw); if (!await repository.canAccessImage(input.scopeKey, input.imageKey, input.actorKey)) throw new MediaLibraryAccessError('Source image access required'); return repository.copyImageToCollection(relation(input)); },
    async moveImageBetweenCollections(raw: unknown) { const input = moveInputSchema.parse(raw); if (!await repository.canAccessImage(input.scopeKey, input.imageKey, input.actorKey)) throw new MediaLibraryAccessError('Source image access required'); return repository.moveImageBetweenCollections(input.sourceCollectionKey, relation(input)); },
    async leaveCollection(raw: unknown) { const input = leaveInputSchema.parse(raw); return repository.leaveCollection(input.scopeKey, input.collectionKey, input.actorKey); },
    async createCollectionInvite(raw: unknown): Promise<{ invite: Omit<CollectionInvite, 'tokenHash'>; token: string }> { const input = inviteInputSchema.parse(raw); if (input.expiresAt && input.expiresAt <= input.now) throw new MediaLibraryAccessError('Invite expiry must be in the future'); if (!await repository.ownsCollection(input.scopeKey, input.collectionKey, input.invitedByKey)) throw new MediaLibraryAccessError('Collection ownership required'); const token = issueToken(); const invite = collectionInviteSchema.parse({ key: requestIdentity('invite', input.scopeKey, input.invitedByKey, input.idempotencyKey), scopeKey: input.scopeKey, collectionKey: input.collectionKey, invitedByKey: input.invitedByKey, ...(input.inviteeKey ? { inviteeKey: input.inviteeKey } : { email: input.email }), role: input.role, tokenHash: sha256(token), ...(input.expiresAt ? { expiresAt: input.expiresAt } : {}), createdAt: input.now, updatedAt: input.now }); const response = { invite: withoutSecrets(invite), token }; const requestHash = requestFingerprint(JSON.stringify({ collectionKey: input.collectionKey, inviteeKey: input.inviteeKey, email: input.email, role: input.role, expiresAt: input.expiresAt })); const saved = await retryIdempotentWrite(() => repository.createCollectionInvite(invite, { requestHash, responseCiphertext: encryptReplay(response) })); if (saved.requestHash !== requestHash) throw new MediaLibraryAccessError('Idempotency key was already used for a different invite'); if (!await repository.ownsCollection(input.scopeKey, input.collectionKey, input.invitedByKey)) throw new MediaLibraryAccessError('Collection ownership required'); return decryptReplay(saved.responseCiphertext) as typeof response; },
    async acceptCollectionInvite(raw: unknown) { const input = acceptInviteInputSchema.parse(raw); const tokenHash = sha256(input.token); return await repository.getAcceptedCollectionInviteMembership(tokenHash, input.recipientKey) ?? repository.acceptCollectionInviteAtomic({ tokenHash, recipientKey: input.recipientKey, now: input.now, memberKey: id() }); },
    async assignTag(raw: unknown) { const input = assignmentInputSchema.parse(raw); const assignment = tagAssignmentSchema.parse({ key: id(), scopeKey: input.scopeKey, tagKey: input.tagKey, sourceType: input.sourceType, sourceKey: input.sourceKey, source: input.source, createdAt: input.now }); const saved = await repository.createTagAssignment(assignment, input.actorKey); if (!saved) throw new MediaLibraryAccessError('Tag and target must be live and in the same scope'); return saved; },
    async setCollectionCoverImage(raw: unknown) { const input = coverInputSchema.parse(raw); if (!await repository.ownsCollection(input.scopeKey, input.collectionKey, input.ownerKey)) throw new MediaLibraryAccessError('Collection ownership required'); const saved = await repository.setCollectionCoverImage(input.scopeKey, input.collectionKey, input.imageKey, input.ownerKey, input.now); if (!saved) throw new MediaLibraryAccessError('Cover image must be a live image in the collection scope'); return saved; },
    async createGlobalShare(raw: unknown) { const input = shareInputSchema.parse(raw); if (input.expiresAt && input.expiresAt <= input.now) throw new MediaLibraryAccessError('Share expiry must be in the future'); const authorize = () => input.sourceType === 'image' ? repository.ownsImage(input.scopeKey, input.sourceKey, input.ownerKey) : input.sourceType === 'collection' ? repository.ownsCollection(input.scopeKey, input.sourceKey, input.ownerKey) : repository.canManageScope(input.scopeKey, input.ownerKey); if (!await authorize()) throw new MediaLibraryAccessError('Share target ownership required'); const token = issueToken(); const share = shareSchema.parse({ key: requestIdentity('share', input.scopeKey, input.ownerKey, input.idempotencyKey), scopeKey: input.scopeKey, sourceType: input.sourceType, sourceKey: input.sourceKey, permission: input.permission, tokenHash: sha256(token), ...(input.password ? { passwordHash: await derivePasswordHash(input.password) } : {}), ...(input.expiresAt ? { expiresAt: input.expiresAt } : {}), createdAt: input.now, updatedAt: input.now }); const response = { share: withoutSecrets(share), token }; const requestHash = requestFingerprint(JSON.stringify({ sourceType: input.sourceType, sourceKey: input.sourceKey, permission: input.permission, expiresAt: input.expiresAt, password: input.password })); const saved = await retryIdempotentWrite(() => repository.createGlobalShare(share, input.ownerKey, { requestHash, responseCiphertext: encryptReplay(response) })); if (!saved) throw new MediaLibraryAccessError('Share target ownership required'); if (saved.requestHash !== requestHash) throw new MediaLibraryAccessError('Idempotency key was already used for a different share'); if (!await authorize()) throw new MediaLibraryAccessError('Share target ownership required'); return decryptReplay(saved.responseCiphertext) as typeof response; },
    async accessGlobalShare(raw: unknown) { const input = accessShareInputSchema.parse(raw); const share = await repository.getActiveGlobalShareByTokenHash(sha256(input.token), input.at); if (!share || (share.passwordHash && (!input.password || !await verifyPassword(input.password, share.passwordHash)))) throw new MediaLibraryAccessError('Share is unavailable'); return { share: withoutSecrets(share) }; },
  };
}

export const mediaLibraryServiceInputSchemas = { relation: relationInputSchema, move: moveInputSchema, leave: leaveInputSchema, invite: inviteInputSchema, acceptInvite: acceptInviteInputSchema, assignment: assignmentInputSchema, cover: coverInputSchema, share: shareInputSchema, accessShare: accessShareInputSchema } as const;
