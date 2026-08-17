import { describe, expect, test } from 'bun:test';
import { newId } from '@/lib/ids';
import type { GalleryOperationContext, GalleryOperationName } from '@/lib/gallery/operations';
import { createGalleryAssistantCapabilities, galleryAssistantCapabilityNames } from './gallery-capabilities';

const organizationKey = newId(), scopeKey = newId();
const membership = { key: newId(), organizationId: organizationKey, userId: newId(), status: 'active' } as any;
const context = { domain: { organizationKey, runtimeScopeKey: scopeKey, principal: { kind: 'member', userOrganization: membership } } } as any;

describe('Gallery assistant capabilities', () => {
  test('covers every canonical operation and exposes no trusted context fields', () => {
    expect(galleryAssistantCapabilityNames).toHaveLength(18);
    expect(new Set(galleryAssistantCapabilityNames).size).toBe(18);
    expect(galleryAssistantCapabilityNames).not.toContain('collection.duplicates.find');
    expect(createGalleryAssistantCapabilities().find(({ definition }) => definition.name === 'image.search')?.definition.inputSchema).toMatchObject({ type: 'object', oneOf: expect.any(Array) });
    for (const capability of createGalleryAssistantCapabilities()) {
      const schema = JSON.stringify(capability.definition.inputSchema);
      expect(schema).not.toContain('organizationKey');
      expect(schema).not.toContain('scopeKey');
      expect(schema).not.toContain('actorKey');
      expect(schema).not.toContain('userKey');
    }
  });

  test('routes every tool to its canonical operation with trusted context injected', async () => {
    const calls: Array<{ operation: GalleryOperationName; input: unknown; context: GalleryOperationContext }> = [];
    const operations = Object.fromEntries([
      'overview', 'createCollection', 'updateCollection', 'deleteCollection', 'search', 'setFavorite', 'updateImage', 'deleteImages', 'deleteDuplicates', 'transferCollectionImages', 'listSubjects', 'createSubject', 'listSubjectImages', 'deleteSubject', 'restoreSubject', 'reserveUploads', 'uploadStatus', 'completeUploads',
    ].map((operation) => [operation, async (input: unknown, trusted: GalleryOperationContext) => { calls.push({ operation: operation as GalleryOperationName, input, context: trusted }); return { operation }; }])) as any;
    const capabilities = createGalleryAssistantCapabilities(operations);
    const imageKey = newId(), collectionKey = newId(), destinationCollectionKey = newId(), identityKey = newId(), uploadKey = newId();
    const inputs = [
      {}, { name: 'Favorites' }, { collectionKey, name: 'Trips', isFavorite: true }, { collectionKey }, { query: 'mountains' }, { imageKey, isFavorite: true }, { imageKey, name: 'mountain.jpg', isFavorite: true }, { imageKeys: [imageKey] },
      { collectionKey, imageKeys: [imageKey] }, { sourceCollectionKey: collectionKey, destinationCollectionKeys: [destinationCollectionKey], imageKeys: [imageKey], mode: 'copy' },
      {}, { name: 'Oscar', imageKeys: [imageKey] }, { identityKey }, { identityKey }, { identityKey },
      { files: [{ clientKey: 'upload-1', filename: 'photo.jpg', sizeBytes: 100 }] }, { uploadKeys: [uploadKey] }, { uploadKeys: [uploadKey] },
    ];
    for (const [index, capability] of capabilities.entries()) expect(await capability.execute(inputs[index], context)).toEqual({ kind: 'continue', result: { operation: calls.at(-1)!.operation } });
    expect(calls.map(({ operation }) => operation)).toEqual(['overview', 'createCollection', 'updateCollection', 'deleteCollection', 'search', 'setFavorite', 'updateImage', 'deleteImages', 'deleteDuplicates', 'transferCollectionImages', 'listSubjects', 'createSubject', 'listSubjectImages', 'deleteSubject', 'restoreSubject', 'reserveUploads', 'uploadStatus', 'completeUploads']);
    for (const call of calls) {
      expect(call.context).toEqual({ organizationKey, scopeKey, membership });
    }
  });

  test('rejects non-member principals before invoking an operation', async () => {
    let called = false;
    const capabilities = createGalleryAssistantCapabilities({ overview: async () => { called = true; return {}; } });
    await expect(capabilities[0]!.execute({}, { domain: { organizationKey, runtimeScopeKey: scopeKey, principal: { kind: 'agent' } } } as any)).rejects.toMatchObject({ code: 'GALLERY_FORBIDDEN' });
    expect(called).toBe(false);
  });

  test('routes similarity and duplicate discovery through image.search', async () => {
    const inputs: unknown[] = [];
    const capability = createGalleryAssistantCapabilities({ search: async (input) => { inputs.push(input); return { images: [] }; } }).find(({ definition }) => definition.name === 'image.search')!;
    const imageKey = newId(), collectionKey = newId();
    await capability.execute({ imageKey }, context);
    await capability.execute({ duplicates: true, collectionKey }, context);
    expect(inputs).toEqual([{ imageKey, limit: 50 }, { duplicates: true, collectionKey }]);
  });
});
