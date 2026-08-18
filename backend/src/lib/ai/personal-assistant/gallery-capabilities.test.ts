import { describe, expect, test } from 'bun:test';
import { newId } from '@/lib/ids';
import type { GalleryOperationContext, GalleryOperationName } from '@/lib/gallery/operations';
import { createGalleryAssistantCapabilities, galleryAssistantCapabilityNames } from './gallery-capabilities';

const organizationKey = newId(), scopeKey = newId();
const membership = { key: newId(), organizationId: organizationKey, userId: newId(), status: 'active' } as any;
const context = { domain: { organizationKey, runtimeScopeKey: scopeKey, principal: { kind: 'member', userOrganization: membership } } } as any;

describe('Gallery assistant capabilities', () => {
  test('covers every canonical operation and exposes no trusted context fields', () => {
    expect(galleryAssistantCapabilityNames).toHaveLength(40);
    expect(new Set(galleryAssistantCapabilityNames).size).toBe(40);
    expect(galleryAssistantCapabilityNames).not.toContain('collection.duplicates.find');
    expect(galleryAssistantCapabilityNames).toEqual(expect.arrayContaining(['highlight.create', 'highlight.list', 'highlight.read', 'highlight.delete']));
    expect(galleryAssistantCapabilityNames).toEqual(expect.arrayContaining(['collection.hide', 'collection.reveal', 'image.hide', 'image.reveal']));
    const search = createGalleryAssistantCapabilities().find(({ definition }) => definition.name === 'image.search')!;
    const listCollections = createGalleryAssistantCapabilities().find(({ definition }) => definition.name === 'collection.list')!;
    const createCollection = createGalleryAssistantCapabilities().find(({ definition }) => definition.name === 'collection.create')!;
    const updateCollection = createGalleryAssistantCapabilities().find(({ definition }) => definition.name === 'collection.update')!;
    expect(createCollection.inputSchema.parse({ name: 'Favorites' })).toEqual({ name: 'Favorites', isFavorite: false });
    expect(() => createCollection.inputSchema.parse({ name: 'Favorites', description: 'Photos' })).toThrow();
    const collectionKey = newId(), coverImageKey = newId();
    expect(updateCollection.inputSchema.parse({ collectionKey, name: 'Favorites', isFavorite: false, coverImageKey })).toMatchObject({ coverImageKey });
    expect(updateCollection.inputSchema.parse({ collectionKey, name: 'Favorites', isFavorite: false, coverImageKey: null })).toMatchObject({ coverImageKey: null });
    expect(() => updateCollection.inputSchema.parse({ collectionKey, name: 'Favorites', isFavorite: false, coverImageKey, forged: true })).toThrow();
    expect(search.definition.inputSchema.type).toBe('object');
    expect(Array.isArray(search.definition.inputSchema.oneOf)).toBe(true);
    expect(search.inputSchema.parse({ identityKey: newId() })).toEqual({ identityKey: expect.any(String) });
    expect(listCollections.inputSchema.parse({ maxCaptionScore: 40 })).toEqual({ maxCaptionScore: 40, limit: 100 });
    expect(listCollections.definition.description).toContain('maximum compatible caption score');
    expect(listCollections.definition.description).toContain('legacy migration placeholder scores are excluded');
    for (const name of ['collection.delete', 'image.delete', 'collection.duplicates.delete']) {
      expect(createGalleryAssistantCapabilities().find(({ definition }) => definition.name === name)!.definition.description.toLowerCase()).toContain('favorite');
    }
    expect(listCollections.definition.inputSchema).toMatchObject({ properties: { maxCaptionScore: { type: 'integer', minimum: 1, maximum: 100 } } });
    expect((search.definition.inputSchema.oneOf as any[]).find(({ required }) => required.includes('identityKey'))).toMatchObject({ additionalProperties: false, properties: { identityKey: { type: 'string' } } });
    for (const capability of createGalleryAssistantCapabilities()) {
      const schema = JSON.stringify(capability.definition.inputSchema);
      expect(schema).not.toContain('organizationKey');
      expect(schema).not.toContain('scopeKey');
      expect(schema).not.toContain('actorKey');
      expect(schema).not.toContain('userKey');
    }
    expect(createGalleryAssistantCapabilities().find(({ definition }) => definition.name === 'highlight.create')?.mutationWorkspace).toBe('gallery');
    expect(createGalleryAssistantCapabilities().find(({ definition }) => definition.name === 'highlight.delete')?.mutationWorkspace).toBe('gallery');
  });

  test('routes every tool to its canonical operation with trusted context injected', async () => {
    const calls: Array<{ operation: GalleryOperationName; input: unknown; context: GalleryOperationContext }> = [];
    const operations = Object.fromEntries([
      'overview', 'createCollection', 'updateCollection', 'deleteCollection', 'listMembers', 'listPendingInvites', 'createInvite', 'acceptInvite', 'rejectInvite', 'revokeInvite', 'updateMemberRole', 'removeMember', 'leaveCollection', 'listShares', 'createShare', 'updateShare', 'revokeShare', 'activateShare', 'search', 'setFavorite', 'updateImage', 'deleteImages', 'deleteDuplicates', 'transferCollectionImages', 'listSubjects', 'createSubject', 'listSubjectImages', 'deleteSubject', 'restoreSubject', 'reserveUploads', 'uploadStatus', 'completeUploads', 'createHighlight', 'listHighlights', 'readHighlight', 'deleteHighlight',
    ].map((operation) => [operation, async (input: unknown, trusted: GalleryOperationContext) => { calls.push({ operation: operation as GalleryOperationName, input, context: trusted }); return { operation }; }])) as any;
    const capabilities = createGalleryAssistantCapabilities(operations);
    const imageKey = newId(), collectionKey = newId(), destinationCollectionKey = newId(), identityKey = newId(), uploadKey = newId(), inviteKey = newId(), memberKey = newId(), shareKey = newId(), highlightKey = newId();
    const inputs = [
      {}, { name: 'Favorites' }, { collectionKey, name: 'Trips', isFavorite: true }, { collectionKey },
      { collectionKey }, {}, { collectionKey, inviteeKey: memberKey, role: 'collaborator' }, { inviteKey }, { inviteKey }, { collectionKey, inviteKey }, { collectionKey, memberKey, role: 'viewer' }, { collectionKey, memberKey }, { collectionKey }, { collectionKey }, { collectionKey, role: 'viewer' }, { collectionKey, shareKey, active: true }, { collectionKey, shareKey }, { token: 'x'.repeat(32) },
      { query: 'mountains' }, { imageKey, isFavorite: true }, { imageKey, name: 'mountain.jpg', isFavorite: true }, { imageKeys: [imageKey] },
      { collectionKey, imageKeys: [imageKey] }, { sourceCollectionKey: collectionKey, destinationCollectionKeys: [destinationCollectionKey], imageKeys: [imageKey], mode: 'copy' },
      {}, { name: 'Oscar', imageKeys: [imageKey] }, { identityKey }, { identityKey }, { identityKey },
      { files: [{ clientKey: 'upload-1', filename: 'photo.jpg', sizeBytes: 100 }] }, { uploadKeys: [uploadKey] }, { uploadKeys: [uploadKey] },
      { collectionKey }, {}, { highlightKey }, { highlightKey },
    ];
    for (const [index, capability] of capabilities.slice(0, inputs.length).entries()) expect(await capability.execute(inputs[index], context)).toEqual({ kind: 'continue', result: { operation: calls.at(-1)!.operation } });
    expect(calls.map(({ operation }) => operation)).toEqual(['overview', 'createCollection', 'updateCollection', 'deleteCollection', 'listMembers', 'listPendingInvites', 'createInvite', 'acceptInvite', 'rejectInvite', 'revokeInvite', 'updateMemberRole', 'removeMember', 'leaveCollection', 'listShares', 'createShare', 'updateShare', 'revokeShare', 'activateShare', 'search', 'setFavorite', 'updateImage', 'deleteImages', 'deleteDuplicates', 'transferCollectionImages', 'listSubjects', 'createSubject', 'listSubjectImages', 'deleteSubject', 'restoreSubject', 'reserveUploads', 'uploadStatus', 'completeUploads', 'createHighlight', 'listHighlights', 'readHighlight', 'deleteHighlight']);
    for (const call of calls) {
      expect(call.context).toEqual({ organizationKey, scopeKey, membership, modelVisible: true });
    }
  });

  test('rejects non-member principals before invoking an operation', async () => {
    let called = false;
    const capabilities = createGalleryAssistantCapabilities({ overview: async () => { called = true; return {}; } });
    await expect(capabilities[0]!.execute({}, { domain: { organizationKey, runtimeScopeKey: scopeKey, principal: { kind: 'agent' } } } as any)).rejects.toMatchObject({ code: 'GALLERY_FORBIDDEN' });
    expect(called).toBe(false);
  });

  test('server-injects idempotency without exposing it in tool schemas', async () => {
    let trusted: GalleryOperationContext | undefined;
    const capability = createGalleryAssistantCapabilities({ createShare: async (_input, context) => { trusted = context; return {}; } }).find(({ definition }) => definition.name === 'collection.share.create')!;
    await capability.execute({ collectionKey: newId(), role: 'viewer' }, { ...context, requestKey: 'request-1' });
    expect(trusted?.idempotencyKey).toBe('request-1');
    expect(JSON.stringify(capability.definition.inputSchema)).not.toContain('idempotency');
  });

  test('redacts bearer material from every model-visible collection share output', async () => {
    const collectionKey = newId(), shareKey = newId();
    const secret = { token: 'secret-token', url: 'https://vorinthex.com/share/secret-token' };
    const operations = {
      listShares: async () => ({ shares: [{ key: shareKey, ...secret }] }),
      createShare: async () => ({ token: secret.token, share: { key: shareKey, ...secret } }),
      updateShare: async () => ({ share: { key: shareKey, ...secret } }),
      revokeShare: async () => ({ share: { key: shareKey, ...secret } }),
    } as any;
    const capabilities = createGalleryAssistantCapabilities(operations);
    const cases = [
      ['collection.share.list', { collectionKey }],
      ['collection.share.create', { collectionKey, role: 'viewer' }],
      ['collection.share.update', { collectionKey, shareKey, active: true }],
      ['collection.share.revoke', { collectionKey, shareKey }],
    ] as const;
    for (const [name, input] of cases) {
      const output = await capabilities.find(({ definition }) => definition.name === name)!.execute(input, context);
      expect(JSON.stringify(output)).not.toContain('secret-token');
      expect(JSON.stringify(output)).not.toContain('/share/');
    }
  });

  test('routes similarity, identity, and duplicate discovery through image.search', async () => {
    const inputs: unknown[] = [];
    const capability = createGalleryAssistantCapabilities({ search: async (input) => { inputs.push(input); return { images: [] }; } }).find(({ definition }) => definition.name === 'image.search')!;
    const imageKey = newId(), identityKey = newId(), collectionKey = newId();
    await capability.execute({ imageKey }, context);
    await capability.execute({ identityKey, collectionKey }, context);
    await capability.execute({ duplicates: true, collectionKey }, context);
    expect(inputs).toEqual([{ imageKey, limit: 50 }, { identityKey, collectionKey }, { duplicates: true, collectionKey }]);
  });
});
