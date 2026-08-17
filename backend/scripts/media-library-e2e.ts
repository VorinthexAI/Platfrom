import { Database } from 'arangojs';
import { newId } from '../src/lib/ids';
import { withDatabaseTransaction } from '../src/lib/db/client';
import { collections as collectionSpecs, migrateContentShares } from '../src/db/arango-migrate';

const url = process.env.ARANGO_URL ?? 'http://127.0.0.1:8529';
process.env.ORCHESTRATION_CREDENTIALS_MASTER_KEY ??= Buffer.alloc(32, 11).toString('base64');
const hostname = new URL(url).hostname;
if (!['localhost', '127.0.0.1', '::1'].includes(hostname)) throw new Error(`Refusing MediaLibrary E2E against non-local Arango host ${hostname}.`);
const system = new Database({ url, auth: { username: process.env.ARANGO_USERNAME ?? 'root', password: process.env.ARANGO_ROOT_PASSWORD ?? '' } });
const databaseName = `mediaLibrary_e2e_${crypto.randomUUID().replaceAll('-', '')}`;
await system.createDatabase(databaseName);
const database = system.database(databaseName);

try {
  const names = ['images', 'collections', 'collectionImages', 'collectionMembers', 'collectionInvites', 'tags', 'tagAssignments', 'shares', 'folders', 'documents', 'places', 'trips', 'scopes', 'scopeMembers', 'userOrganizations', 'users', 'documentShares'];
  await Promise.all(names.map((name) => database.createCollection(name)));
  for (const spec of collectionSpecs.filter(({ name }) => names.includes(name))) for (const index of spec.indexes ?? []) await database.collection(spec.name).ensureIndex({ type: 'persistent', sparse: false, unique: false, ...index });
  const [{ createMediaLibraryRepository }, { createMediaLibraryService }, { processImage }, { imageSchema }] = await Promise.all([
    import('../src/lib/media-library/repository'), import('../src/lib/media-library/service'), import('../src/lib/ai/image-processing'), import('../src/lib/db/images.node'),
  ]);
  const transactionCollections = ['images', 'collections', 'collectionImages', 'collectionMembers', 'collectionInvites', 'tags', 'tagAssignments', 'shares', 'documents', 'places', 'trips', 'scopes', 'scopeMembers', 'userOrganizations', 'users'];
  const repository = createMediaLibraryRepository(database, (operation) => withDatabaseTransaction(database, transactionCollections, (transaction) => operation(transaction)));
  let tokenSequence = 0;
  const service = createMediaLibraryService({ repository, token: () => `media-library-e2e-token-${String(++tokenSequence).padStart(32, '0')}` });
  const scopeKey = newId(); const actorKey = newId(); const strangerKey = newId(); const collectionKey = newId(); const imageKey = newId(); const tagKey = newId(); const now = new Date().toISOString();
  await database.collection('scopes').save({ _key: scopeKey, organizationKey: 'media-library-e2e-org', deletedAt: null });
  await database.collection('userOrganizations').import([{ _key: actorKey, organizationId: 'media-library-e2e-org', userId: newId(), orgRole: 'member', status: 'active' }, { _key: strangerKey, organizationId: 'media-library-e2e-org', userId: newId(), orgRole: 'member', status: 'active' }]);
  await database.collection('collections').save({ _key: collectionKey, scopeKey, name: 'Launch', description: 'Launch imagery', embedding: Array(4096).fill(0), isFavorite: false, deletedAt: null, createdAt: now, updatedAt: now });
  const sourceOwnerMembershipKey = newId();
  await database.collection('collectionMembers').save({ _key: sourceOwnerMembershipKey, scopeKey, collectionKey, memberKey: actorKey, role: 'owner', createdAt: now });
  await database.collection('images').save({ _key: imageKey, scopeKey, filename: 'launch.png', caption: 'A launch vehicle', storageKey: 'mediaLibrary/e2e.png', mimeType: 'image/png', sizeBytes: 24, width: 1, height: 1, embedding: Array(4096).fill(0), isFavorite: false, deletedAt: null, createdAt: now, updatedAt: now });
  await database.collection('tags').save({ _key: tagKey, scopeKey, name: 'Launch', embedding: Array(4096).fill(0), createdAt: now, updatedAt: now });
  const membership = await service.addImageToCollection({ scopeKey, collectionKey, imageKey, actorKey, now });
  const assignment = await service.assignTag({ scopeKey, tagKey, sourceType: 'image', sourceKey: imageKey, source: 'user', actorKey, now });
  const cover = await service.setCollectionCoverImage({ scopeKey, collectionKey, imageKey, ownerKey: actorKey, now });
  if (cover.coverImageKey !== imageKey) throw new Error('Collection cover membership verification failed.');
  const unrelatedImageKey = newId();
  await database.collection('images').save({ _key: unrelatedImageKey, scopeKey, filename: 'other.png', caption: 'Other', storageKey: 'mediaLibrary/other.png', mimeType: 'image/png', sizeBytes: 24, width: 1, height: 1, embedding: Array(4096).fill(0), isFavorite: false, deletedAt: null, createdAt: now, updatedAt: now });
  let unrelatedCoverRejected = false;
  try { await service.setCollectionCoverImage({ scopeKey, collectionKey, imageKey: unrelatedImageKey, ownerKey: actorKey, now }); } catch { unrelatedCoverRejected = true; }
  if (!unrelatedCoverRejected) throw new Error('Unrelated image was accepted as collection cover.');
  const destinationCollectionKey = newId();
  await database.collection('collections').save({ _key: destinationCollectionKey, scopeKey, name: 'Destination', description: 'Destination imagery', embedding: Array(4096).fill(0), isFavorite: false, deletedAt: null, createdAt: now, updatedAt: now });
  const destinationOwnerMembershipKey = newId();
  await database.collection('collectionMembers').save({ _key: destinationOwnerMembershipKey, scopeKey, collectionKey: destinationCollectionKey, memberKey: actorKey, role: 'owner', createdAt: now });
  await service.moveImageBetweenCollections({ scopeKey, sourceCollectionKey: collectionKey, collectionKey: destinationCollectionKey, imageKey, actorKey, now });
  const sourceAfterMove = await database.collection('collections').document(collectionKey) as Record<string, unknown>;
  if ('coverImageKey' in sourceAfterMove) throw new Error('Moving a cover image did not clear the source cover atomically.');
  const attackerCollectionKey = newId();
  await database.collection('collections').save({ _key: attackerCollectionKey, scopeKey, name: 'Attacker destination', description: 'Unauthorized destination', embedding: Array(4096).fill(0), isFavorite: false, deletedAt: null, createdAt: now, updatedAt: now });
  await database.collection('collectionMembers').save({ _key: newId(), scopeKey, collectionKey: attackerCollectionKey, memberKey: strangerKey, role: 'owner', createdAt: now });
  let inaccessibleAttachRejected = false;
  try { await service.addImageToCollection({ scopeKey, collectionKey: attackerCollectionKey, imageKey, actorKey: strangerKey, now }); } catch { inaccessibleAttachRejected = true; }
  const escalatedRelation = await (await database.query<number>('RETURN LENGTH(FOR link IN collectionImages FILTER link.collectionKey == @collectionKey && link.imageKey == @imageKey RETURN 1)', { collectionKey: attackerCollectionKey, imageKey })).next() ?? 0;
  if (!inaccessibleAttachRejected || escalatedRelation !== 0) throw new Error('An inaccessible source image was attached to an attacker-owned collection.');

  const png = (width: number, height: number) => { const bytes = new Uint8Array(24); bytes.set([137, 80, 78, 71, 13, 10, 26, 10]); bytes.set([73, 72, 68, 82], 12); new DataView(bytes.buffer).setUint32(16, width); new DataView(bytes.buffer).setUint32(20, height); return bytes; };
  const objects = new Map<string, Uint8Array>(); let uploads = 0, deletes = 0;
  const storage = { async upload({ key, bytes }: { key: string; bytes: Uint8Array }) { uploads += 1; objects.set(key, bytes); return { storageKey: key }; }, async delete(key: string) { deletes += 1; objects.delete(key); }, async download(key: string) { return { bytes: objects.get(key) ?? new Uint8Array() }; }, async copy(sourceKey: string, destinationKey: string) { objects.set(destinationKey, objects.get(sourceKey) ?? new Uint8Array()); return { storageKey: destinationKey }; } };
  const getProcessedImage = async (key: string) => { const raw = await database.collection('images').document(key).catch(() => null); return raw ? imageSchema.parse({ ...raw, key: (raw as { _key: string })._key }) : null; };
  const insertProcessedImage = async (image: ReturnType<typeof imageSchema.parse>) => { const { key, ...document } = image; await database.collection('images').save({ _key: key, ...document }); return image; };
  const processingInput = { scopeKey, ownerKey: actorKey, file: { filename: 'processed.png', mimeType: 'image/png', sizeBytes: 24, bytes: png(8, 6) }, idempotencyKey: 'processed-e2e' };
  const processingDependencies = { storage, caption: async () => ({ caption: 'A deterministic processed image.', score: 80 }), embed: async () => Array(4096).fill(0.125), getImage: getProcessedImage, persistImage: async ({ image, caption }: any) => { if (caption) { const { key, ...document } = caption; await database.collection('imageCaptions').save({ _key: key, ...document }); } return insertProcessedImage(image); } };
  const processed = await processImage(processingInput, processingDependencies);
  const processedReplay = await processImage(processingInput, processingDependencies);
  if (processed.key !== processedReplay.key || processed.embedding.length !== 4096 || uploads !== 1) throw new Error('Image processing validation/idempotency contract failed.');
  let cleanupFailed = false;
  try { await processImage({ ...processingInput, idempotencyKey: 'cleanup-e2e', file: { ...processingInput.file, filename: 'cleanup.png' } }, { ...processingDependencies, embed: async () => Array(4095).fill(0) }); } catch { cleanupFailed = true; }
  if (!cleanupFailed || deletes !== 1) throw new Error('Image processing failure did not clean uploaded storage.');
  const inviteInput = { scopeKey, collectionKey, invitedByKey: actorKey, inviteeKey: actorKey, expiresAt: new Date(Date.now() + 60_000).toISOString(), now, idempotencyKey: 'invite-e2e' };
  const [invite, inviteRetry] = await Promise.all([service.createCollectionInvite(inviteInput), service.createCollectionInvite(inviteInput)]);
  if (invite.token !== inviteRetry.token || invite.invite.key !== inviteRetry.invite.key) throw new Error('Invite idempotency race did not replay the original result.');
  const storedInvite = await database.collection('collectionInvites').document(invite.invite.key) as Record<string, unknown>;
  if (typeof storedInvite.responseCiphertext !== 'string' || storedInvite.responseCiphertext.includes(invite.token)) throw new Error('Invite replay token was not encrypted at rest.');
  let inviteConflict = false;
  try { await service.createCollectionInvite({ ...inviteInput, expiresAt: new Date(Date.now() + 120_000).toISOString() }); } catch { inviteConflict = true; }
  if (!inviteConflict) throw new Error('Invite idempotency payload conflict was accepted.');
  await database.collection('collectionMembers').remove(sourceOwnerMembershipKey);
  let inviteReplayAfterAccessLossRejected = false;
  try { await service.createCollectionInvite(inviteInput); } catch { inviteReplayAfterAccessLossRejected = true; }
  if (!inviteReplayAfterAccessLossRejected) throw new Error('Removed collection owner recovered an invite token replay.');
  await database.collection('collectionMembers').save({ _key: sourceOwnerMembershipKey, scopeKey, collectionKey, memberKey: actorKey, role: 'owner', createdAt: now });
  const accepted = await service.acceptCollectionInvite({ token: invite.token, recipientKey: actorKey, now });
  const acceptedRetry = await service.acceptCollectionInvite({ token: invite.token, recipientKey: actorKey, now: new Date(Date.now() + 180_000).toISOString() });
  if (!accepted || accepted.key !== acceptedRetry?.key || accepted.collectionKey !== collectionKey) throw new Error('Invitation acceptance replay failed.');
  const shareInput = { scopeKey, sourceType: 'image' as const, sourceKey: imageKey, ownerKey: actorKey, password: 'mediaLibrary password', now, idempotencyKey: 'share-e2e' };
  const [projected, projectedRetry] = await Promise.all([service.createGlobalShare(shareInput), service.createGlobalShare(shareInput)]);
  if (projected.token !== projectedRetry.token || projected.share.key !== projectedRetry.share.key) throw new Error('Share idempotency race did not replay the original result.');
  await database.collection('collectionMembers').remove(destinationOwnerMembershipKey);
  await database.query('UPDATE @key WITH { ownerKey: null } IN images OPTIONS { keepNull: false }', { key: imageKey });
  let shareReplayAfterAccessLossRejected = false;
  try { await service.createGlobalShare(shareInput); } catch { shareReplayAfterAccessLossRejected = true; }
  if (!shareReplayAfterAccessLossRejected) throw new Error('Removed image owner recovered a share token replay.');
  await database.collection('images').update(imageKey, { ownerKey: actorKey });
  await database.collection('collectionMembers').save({ _key: destinationOwnerMembershipKey, scopeKey, collectionKey: destinationCollectionKey, memberKey: actorKey, role: 'owner', createdAt: now });
  if (membership.imageKey !== imageKey || assignment.sourceKey !== imageKey || 'tokenHash' in projected.share || 'passwordHash' in projected.share) throw new Error('MediaLibrary projection verification failed.');
  const accessed = await service.accessGlobalShare({ token: projected.token, password: 'mediaLibrary password', at: now });
  if (accessed.share.key !== projected.share.key || 'tokenHash' in accessed.share || 'passwordHash' in accessed.share) throw new Error('MediaLibrary active share lookup leaked secrets or returned the wrong source.');
  await database.collection('shares').update(projected.share.key, { revokedAt: now, updatedAt: now });
  let revokedRejected = false;
  try { await service.accessGlobalShare({ token: projected.token, password: 'mediaLibrary password', at: now }); } catch { revokedRejected = true; }
  if (!revokedRejected) throw new Error('Revoked MediaLibrary share remained active.');
  let unauthorizedRejected = false;
  try { await service.createGlobalShare({ scopeKey, sourceType: 'collection', sourceKey: collectionKey, ownerKey: strangerKey, now, idempotencyKey: 'unauthorized-share' }); } catch { unauthorizedRejected = true; }
  if (!unauthorizedRejected) throw new Error('Unauthorized share unexpectedly succeeded.');

  const documentKey = newId(); const legacyKey = newId();
  await database.collection('documents').save({ _key: documentKey, scopeKey });
  await database.collection('documentShares').save({ _key: legacyKey, scopeKey, documentKey, token: 'legacy-media-library-e2e-token', permission: 'edit', createdAt: now, updatedAt: now });
  await migrateContentShares(database);
  if (!await database.collection('documentShares').exists()) throw new Error('First migration pass must retain documentShares in dual-write mode.');
  const { createContentPersistence } = await import('../src/lib/db/content-persistence.node');
  const content = createContentPersistence(database as never);
  const dualKey = newId();
  await content.insertShare({ key: dualKey, scopeKey, documentKey, permission: 'read', tokenHash: 'e'.repeat(64), createdAt: now, updatedAt: now });
  await content.updateShare(scopeKey, dualKey, { revokedAt: now, updatedAt: now });
  const [dualGlobal, dualLegacy] = await Promise.all([database.collection('shares').document(dualKey), database.collection('documentShares').document(dualKey)]) as Array<Record<string, unknown>>;
  if (dualGlobal.revokedAt !== now || dualLegacy.revokedAt !== now) throw new Error('Dual-mode update was not mirrored atomically.');
  if (!await content.deleteShare(scopeKey, dualKey) || await database.collection('shares').documentExists(dualKey) || await database.collection('documentShares').documentExists(dualKey)) throw new Error('Dual-mode delete did not remove both records atomically.');
  const catchupDocumentKey = newId(); const catchupShareKey = newId();
  await database.collection('documents').save({ _key: catchupDocumentKey, scopeKey });
  await database.collection('documentShares').save({ _key: catchupShareKey, scopeKey, documentKey: catchupDocumentKey, token: 'legacy-catchup-token', permission: 'read', createdAt: now, updatedAt: now });
  await migrateContentShares(database);
  if (!await database.collection('documentShares').exists()) throw new Error('Global cutover pass must retain documentShares for a deployment overlap.');
  await database.collection('shares').update(legacyKey, { revokedAt: now, updatedAt: now });
  let mismatchBlockedDrop = false;
  try { await migrateContentShares(database); } catch { mismatchBlockedDrop = true; }
  if (!mismatchBlockedDrop || !await database.collection('documentShares').exists()) throw new Error('Canonical lifecycle mismatch did not block legacy drop.');
  await database.query('UPDATE @key WITH { revokedAt: null } IN shares OPTIONS { keepNull: false }', { key: legacyKey });
  await migrateContentShares(database);
  const migrated = await database.collection('shares').document(legacyKey) as Record<string, unknown>;
  if (migrated.sourceType !== 'document' || migrated.sourceKey !== documentKey || migrated.permission !== 'comment' || migrated.revokedAt != null || typeof migrated.tokenHash !== 'string') throw new Error('Legacy share migration verification failed.');
  if (await database.collection('documentShares').exists()) throw new Error('Legacy documentShares collection was not dropped.');
  const caughtUp = await database.collection('shares').document(catchupShareKey) as Record<string, unknown>;
  if (caughtUp.sourceKey !== catchupDocumentKey) throw new Error('Catch-up share was not migrated before cutover.');
  const postDrop = await content.insertShare({ key: newId(), scopeKey, documentKey, permission: 'read', tokenHash: 'f'.repeat(64), createdAt: now, updatedAt: now });
  const archivedPostDrop = await content.updateShare(scopeKey, postDrop.key, { deletedAt: now, updatedAt: now });
  const restoredPostDrop = await content.updateShare(scopeKey, postDrop.key, { deletedAt: null, updatedAt: now });
  const listed = await content.listShares(scopeKey, [documentKey]);
  if (postDrop.documentKey !== documentKey || archivedPostDrop?.deletedAt !== now || restoredPostDrop?.deletedAt !== null || !listed.some((share) => share.key === postDrop.key) || 'sourceType' in postDrop || 'sourceKey' in postDrop) throw new Error('Post-drop Content share compatibility failed.');
  console.log('MediaLibrary E2E passed: MediaLibrary authorization/shares, phased catch-up/cutover/drop, and post-drop Content shares.');
} finally {
  await system.dropDatabase(databaseName);
}
