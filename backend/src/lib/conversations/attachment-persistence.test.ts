import { describe, expect, test } from 'bun:test';
import { newId } from '@/lib/ids';
import type { ToolContext } from '@/lib/ai/tools';
import type { ConversationAttachmentArtifact } from './attachment-artifacts';
import { persistConversationAttachment, prepareConversationAttachments } from './attachment-persistence';

const teamKey = 'team', scopeKey = newId(), userKey = newId(), actorKey = newId(), at = '2026-09-04T00:00:00.000Z';
const context = { teamKey, runtimeScopeKey: scopeKey, principal: { kind: 'member', user: { key: userKey }, userTeam: { key: actorKey, teamKey, userId: userKey, status: 'active' } } } as unknown as ToolContext;
const authorization = async () => ({ allowed: true, scope: { key: scopeKey, teamKey }, teamDecision: { membership: { key: actorKey, userId: userKey } } }) as never;
function artifact(kind: 'document' | 'image'): ConversationAttachmentArtifact {
  const key = newId();
  return { key, ownerKey: actorKey, teamKey, scopeKey, userKey, conversationKey: newId(), requestKey: 'request', userMessageKey: newId(), kind, filename: kind === 'document' ? 'notes.txt' : 'photo.png', mimeType: kind === 'document' ? 'text/plain' : 'image/png', sizeBytes: 3, ...(kind === 'image' ? { width: 1, height: 1 } : {}), stagedStorageKey: `pending/${key}`, stagedSha256: '039058c6f2c0cb492c533b0a4d14ef77cc0f78abccced5287d84a1a2011cfb81', status: 'CLAIMED', attempts: 0, availableAt: at, createdAt: at, expiresAt: '2026-10-04T00:00:00.000Z' };
}

describe('durable conversation attachment persistence', () => {
  test('downloads original document and canonical image bytes for Core', async () => {
    const document = artifact('document'), image = artifact('image'); const downloads: string[] = [];
    const output = await prepareConversationAttachments([document, image], context, { authorize: authorization, storage: { download: async (key) => { downloads.push(key); return { bytes: new Uint8Array([1, 2, 3]) }; }, delete: async () => undefined } });
    expect(output).toEqual([{ kind: 'document', filename: 'notes.txt', mimeType: 'text/plain', bytes: new Uint8Array([1, 2, 3]) }, { kind: 'image', filename: 'photo.png', mimeType: 'image/png', bytes: new Uint8Array([1, 2, 3]) }]);
    expect(downloads).toEqual([document.stagedStorageKey, image.stagedStorageKey]);
  });

  test('runs normal document parsing asynchronously and uses the trusted canonical PNG path', async () => {
    const document = artifact('document'), image = artifact('image'); let parseDependencies: unknown; let imageInput: any;
    const documentReference = await persistConversationAttachment(document, context, { authorize: authorization, storage: { download: async () => ({ bytes: new Uint8Array([1, 2, 3]) }), delete: async () => undefined }, parse: async (input, dependencies) => { parseDependencies = dependencies; return { document: { key: newId(), ...input } } as never; } });
    const imageReference = await persistConversationAttachment(image, context, { authorize: authorization, storage: { download: async () => ({ bytes: new Uint8Array([1, 2, 3]) }), delete: async () => undefined }, embedCollection: async () => [1], process: async (inputs) => { imageInput = inputs[0]; return [{ key: newId(), filename: 'photo.png', mimeType: 'image/png', sizeBytes: 3, width: 1, height: 1 }] as never; }, gallery: { ensureGeneratedMediaCollection: async () => ({ key: newId() }) as never, attachConversationMedia: async () => true, deleteImages: async () => null }, now: () => at });
    expect(parseDependencies).not.toMatchObject({ actions: { extract: expect.any(Function) } });
    expect(documentReference.kind).toBe('document');
    expect(imageInput).toMatchObject({ idempotencyKey: `conversation-attachment:${image.key}`, trustedCanonicalPng: { sha256: image.stagedSha256, width: 1, height: 1 } });
    expect(imageReference.kind).toBe('image');
  });

  test('rejects owner mismatches before any download', async () => {
    let downloaded = false;
    await expect(prepareConversationAttachments([artifact('document')], { ...context, teamKey: 'other' }, { storage: { download: async () => { downloaded = true; return { bytes: new Uint8Array() }; }, delete: async () => undefined } })).rejects.toThrow('matching member identity');
    expect(downloaded).toBe(false);
  });
});
