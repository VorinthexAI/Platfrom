import { describe, expect, test } from 'bun:test';
import { newId } from '@/lib/ids';
import type { ToolContext } from '@/lib/ai/tools';
import type { ConversationAttachmentArtifact } from './attachment-artifacts';
import { persistConversationAttachment, prepareConversationAttachments } from './attachment-persistence';

const teamKey = 'team', scopeKey = newId(), userKey = newId(), actorKey = newId(), at = '2026-09-04T00:00:00.000Z';
const context = { teamKey, runtimeScopeKey: scopeKey, principal: { kind: 'member', user: { key: userKey }, userTeam: { key: actorKey, teamKey, userId: userKey, status: 'active' } } } as unknown as ToolContext;
const authorization = async () => ({ allowed: true, scope: { key: scopeKey, teamKey }, teamDecision: { membership: { key: actorKey, userId: userKey } } }) as never;
function artifact(kind: 'document' | 'image', overrides: Partial<ConversationAttachmentArtifact> = {}): ConversationAttachmentArtifact {
  const key = newId();
  return { key, ownerKey: actorKey, teamKey, scopeKey, userKey, conversationKey: newId(), requestKey: 'request', userMessageKey: newId(), kind, filename: kind === 'document' ? 'notes.txt' : 'photo.png', mimeType: kind === 'document' ? 'text/plain' : 'image/png', sizeBytes: 3, ...(kind === 'image' ? { width: 1, height: 1 } : {}), stagedStorageKey: `pending/${key}`, stagedSha256: '039058c6f2c0cb492c533b0a4d14ef77cc0f78abccced5287d84a1a2011cfb81', status: 'CLAIMED', attempts: 0, availableAt: at, createdAt: at, expiresAt: '2026-10-04T00:00:00.000Z', ...overrides } as ConversationAttachmentArtifact;
}

describe('durable conversation attachment persistence', () => {
  test('downloads original document and canonical image bytes for Core', async () => {
    const document = artifact('document'), image = artifact('image'); const downloads: string[] = [];
    const output = await prepareConversationAttachments([document, image], context, { authorize: authorization, storage: { download: async (key) => { downloads.push(key); return { bytes: new Uint8Array([1, 2, 3]) }; }, delete: async () => undefined } });
    expect(output).toEqual([{ kind: 'document', filename: 'notes.txt', mimeType: 'text/plain', bytes: new Uint8Array([1, 2, 3]) }, { kind: 'image', filename: 'photo.png', mimeType: 'image/png', bytes: new Uint8Array([1, 2, 3]) }]);
    expect(downloads).toEqual([document.stagedStorageKey, image.stagedStorageKey]);
  });

  test('preserves ordered original bytes across mixed document formats', async () => {
    const first = artifact('document', { filename: 'first.md', mimeType: 'text/markdown' });
    const second = artifact('document', { filename: 'second.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
    const output = await prepareConversationAttachments([first, second], context, { authorize: authorization, storage: { download: async () => ({ bytes: new Uint8Array([1, 2, 3]) }), delete: async () => undefined } });
    expect(output).toEqual([
      { kind: 'document', filename: 'first.md', mimeType: 'text/markdown', bytes: new Uint8Array([1, 2, 3]) },
      { kind: 'document', filename: 'second.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', bytes: new Uint8Array([1, 2, 3]) },
    ]);
  });

  test('runs normal document and image processing asynchronously', async () => {
    const document = artifact('document', { documentContent: 'Legacy extracted notes' }), image = artifact('image', { displayKey: 'local-photo', filename: 'photo.jpg', mimeType: 'image/jpeg' }); let parseInput: any; let parseDependencies: any; let imageInput: any;
    const documentReference = await persistConversationAttachment(document, context, { authorize: authorization, storage: { download: async () => ({ bytes: new Uint8Array([1, 2, 3]) }), delete: async () => undefined }, parse: async (input, dependencies) => { parseInput = input; parseDependencies = dependencies; return { document: { key: newId(), ...input } } as never; } });
    const imageReference = await persistConversationAttachment(image, context, { authorize: authorization, storage: { download: async () => ({ bytes: new Uint8Array([1, 2, 3]) }), delete: async () => undefined }, embedCollection: async () => [1], ingestGalleryUpload: async (input) => { imageInput = input; return { key: newId(), filename: 'photo.png', mimeType: 'image/png', sizeBytes: 3, width: 1, height: 1 } as never; }, gallery: { ensureGeneratedMediaCollection: async () => ({ key: newId() }) as never }, now: () => at });
    expect(parseInput.file.bytes).toEqual(new Uint8Array([1, 2, 3]));
    expect(parseDependencies).not.toHaveProperty('actions.extract');
    expect(documentReference.kind).toBe('document');
    expect(imageInput).toMatchObject({ filename: 'photo.jpg', mimeType: 'image/jpeg', bytes: new Uint8Array([1, 2, 3]), imageKey: image.key });
    expect(imageReference).toMatchObject({ kind: 'image', displayKey: 'local-photo' });
  });

  test('rejects owner mismatches before any download', async () => {
    let downloaded = false;
    await expect(prepareConversationAttachments([artifact('document')], { ...context, teamKey: 'other' }, { storage: { download: async () => { downloaded = true; return { bytes: new Uint8Array() }; }, delete: async () => undefined } })).rejects.toThrow('matching member identity');
    expect(downloaded).toBe(false);
  });
});
