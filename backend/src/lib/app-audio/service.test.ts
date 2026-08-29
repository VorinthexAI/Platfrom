import { describe, expect, test } from 'bun:test';
import { newId } from '@/lib/ids';
import type { ToolContext } from '@/lib/ai/tools/tool-context';
import { createAppAudioService } from './service';

const organizationKey = newId(), scopeKey = newId(), userKey = newId(), documentKey = newId(), audioKey = newId();
const timestamp = '2026-08-27T12:00:00.000Z';
const context = { organizationKey, runtimeScopeKey: scopeKey, principal: { kind: 'member', user: { key: userKey }, userOrganization: { key: newId(), organizationId: organizationKey, userId: userKey, status: 'active' } } } as unknown as ToolContext;
const document = { key: documentKey, scopeKey, name: 'Architecture', content: 'Read this.\n```ts\nconst secret = true;\n```', embedding: [], mutationPolicy: 'user', archiveVisibility: 'visible', isFavorite: false, createdAt: timestamp, updatedAt: timestamp } as any;
const authorized = async () => ({ results: [{ success: true, data: { document: { ...document, content: document.content } } }] }) as any;

describe('canonical app audio service', () => {
  test('maps voice, falls back duration, uploads, persists, and returns the signed document DTO', async () => {
    const calls: unknown[][] = [];
    const service = createAppAudioService({
      repository: { getDocument: async () => document, createAudioVersion: async (value: any) => ({ ...value, version: 1, isCurrent: false, playbackPositionMs: 0 }) },
      executeContent: authorized,
      speech: async (...args: any[]) => { calls.push(['speech', ...args]); return { bytes: new Uint8Array([1, 2, 3]), mimeType: 'audio/mpeg' }; },
      storage: { upload: async (input) => { calls.push(['upload', input]); return { storageKey: input.key }; }, delete: async (key) => { calls.push(['delete', key]); } },
      signAudioUrl: async (key) => `https://audio.example/${key}`,
      publishChanged: async (key) => { calls.push(['publish', key]); }, id: () => audioKey, now: () => timestamp,
    });
    const output = await service.generateDocument({ documentKey, voice: 'warm', pace: 1, includeTitle: true, includeCode: false }, context);
    expect(calls[0]?.[1]).toEqual({ text: 'Architecture.\n\nRead this.', language: 'English', voice: 'coral', pace: 1, format: 'mp3' });
    expect(output).toMatchObject({ key: audioKey, documentKey, version: 1, mimeType: 'audio/mpeg', sizeBytes: 3, durationMs: 2_000, voice: 'warm', speakingRate: 1, includeTitle: true, includeCode: false, current: true, url: expect.stringContaining('https://audio.example/') });
    expect(JSON.stringify(output)).not.toMatch(/storageKey|createdByKey|scopeKey/);
    expect(calls).toContainEqual(['publish', scopeKey]);
  });

  test('compensates an uploaded object when target persistence fails', async () => {
    const deleted: string[] = [];
    const service = createAppAudioService({
      storage: { upload: async ({ key }) => ({ storageKey: key }), delete: async (key) => { deleted.push(key); } },
      speech: async () => ({ bytes: new Uint8Array([1]), mimeType: 'audio/mpeg', durationSeconds: 9 }),
    });
    await expect(service.generateForTarget({ organizationKey, storageKey: 'audio/failure.mp3', text: 'Narrate this.', voice: 'clear', pace: 1 }, { persist: async () => { throw new Error('lease lost'); } })).rejects.toThrow('lease lost');
    expect(deleted).toEqual(['audio/failure.mp3']);
  });

  test('estimates 810 normal-pace words as five minutes when the provider omits duration', async () => {
    const service = createAppAudioService({
      speech: async () => ({ bytes: new Uint8Array([1]), mimeType: 'audio/mpeg' }),
      storage: { upload: async ({ key }) => ({ storageKey: key }), delete: async () => {} },
    });
    const output = await service.generateForTarget({ organizationKey, storageKey: 'audio/five-minutes.mp3', text: Array(810).fill('word').join(' '), voice: 'clear', pace: 1 }, { persist: async (audio) => audio });
    expect(output).toMatchObject({ storageKey: 'audio/five-minutes.mp3', durationSeconds: 300 });
  });

  test('does not upload after provider failure or persist after storage failure', async () => {
    let uploads = 0, persists = 0;
    const providerFailure = createAppAudioService({ speech: async () => { throw new Error('provider failed'); }, storage: { upload: async ({ key }) => { uploads += 1; return { storageKey: key }; }, delete: async () => {} } });
    await expect(providerFailure.generateForTarget({ organizationKey, storageKey: 'audio/provider.mp3', text: 'Narrate.', voice: 'clear', pace: 1 }, { persist: async () => { persists += 1; } })).rejects.toThrow('provider failed');
    const storageFailure = createAppAudioService({ speech: async () => ({ bytes: new Uint8Array([1]), mimeType: 'audio/mpeg' }), storage: { upload: async () => { uploads += 1; throw new Error('storage failed'); }, delete: async () => {} } });
    await expect(storageFailure.generateForTarget({ organizationKey, storageKey: 'audio/storage.mp3', text: 'Narrate.', voice: 'clear', pace: 1 }, { persist: async () => { persists += 1; } })).rejects.toThrow('storage failed');
    expect({ uploads, persists }).toEqual({ uploads: 1, persists: 0 });
  });

  test('rejects inactive identity and documents outside the injected runtime scope before speech', async () => {
    let speeches = 0;
    const service = createAppAudioService({ repository: { getDocument: async () => document, createAudioVersion: async () => { throw new Error('unexpected'); } }, executeContent: authorized, speech: async () => { speeches += 1; return { bytes: new Uint8Array([1]), mimeType: 'audio/mpeg' }; } });
    const principal = context.principal as Extract<ToolContext['principal'], { kind: 'member' }>;
    await expect(service.generateDocument({ documentKey }, { ...context, principal: { ...principal, userOrganization: { ...principal.userOrganization, status: 'inactive' } } } as ToolContext)).rejects.toMatchObject({ code: 'CONTENT_FORBIDDEN' });
    await expect(service.generateDocument({ documentKey }, { ...context, runtimeScopeKey: newId() })).rejects.toMatchObject({ code: 'CONTENT_NOT_FOUND' });
    expect(speeches).toBe(0);
  });
});
