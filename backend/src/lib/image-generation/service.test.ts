import { describe, expect, test } from 'bun:test';
import { newId } from '@/lib/ids';
import type { ToolContext } from '@/lib/ai/tools/tool-context';
import type { ProcessImageInput } from '@/lib/ai/image-processing';
import { createImageGenerationService, imageGenerateModelInputSchema, imageIdeasInputSchema, parseImageIdeas } from './service';

const organizationKey = newId(), scopeKey = newId(), membershipKey = newId(), collectionKey = newId();
const context = {
  organizationKey,
  runtimeScopeKey: scopeKey,
  principal: { kind: 'member', user: { key: newId() }, userOrganization: { key: membershipKey } },
} as unknown as ToolContext;

const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).toString('base64');
const authorizedGallery = { getCollectionRole: async () => 'owner' as const, canAccessImage: async () => true, getImage: async () => null, attachGeneratedImages: async () => true };
const safeAsk = (async () => ({ output: { text: '{"safe":true}', toolCalls: [], stopReason: 'completed' }, usage: {}, providerId: 'openrouter', modelId: 'model', externalModelId: 'model' })) as any;
const history = { record: async () => ({}), list: async () => [], remove: async () => ({ normalizedPrompt: '', deleted: false }) } as any;
const claimedLedger = () => ({ claim: async () => ({ status: 'claimed' as const }), start: async () => true, renew: async () => true, complete: async () => {}, fail: async () => {}, release: async () => {} });
const persistedImage = (key = newId()) => ({ key, scopeKey, filename: 'generated.png', caption: 'Earth', imageCaptionKey: newId(), createdByKey: membershipKey, storageKey: `durable/${key}.png`, mimeType: 'image/png', sizeBytes: 8, width: 1024, height: 1024, embedding: [], origin: 'generated', isFavorite: false, createdAt: '2026-08-19T00:00:00.000Z', updatedAt: '2026-08-19T00:00:00.000Z' }) as any;

describe('image generation service', () => {
  test('uses strict bounded contracts and an exact distinct fallback', () => {
    expect(() => imageIdeasInputSchema.parse({ prompt: 'A globe', requestedCount: 2, organizationKey })).toThrow('Unrecognized key');
    expect(() => imageIdeasInputSchema.parse({ prompt: 'A globe', requestedCount: 9 })).toThrow();
    expect(() => imageGenerateModelInputSchema.parse({ prompt: 'A globe', count: 1, size: '512x512', quality: 'high' })).toThrow();
    expect(imageGenerateModelInputSchema.parse({ prompt: 'A globe', collectionKey }).mode).toBe('default');
    expect(imageGenerateModelInputSchema.parse({ prompt: 'A globe', collectionKey, count: 1, size: '1536x1024', quality: 'low', mode: 'fast' }).mode).toBe('fast');
    expect(() => imageGenerateModelInputSchema.parse({ prompt: 'A globe', collectionKey, referenceImageKeys: [scopeKey, scopeKey] })).toThrow('distinct');
    const input = imageIdeasInputSchema.parse({ prompt: 'A globe', requestedCount: 3, style: 'editorial', colors: ['navy', 'gold'] });
    const concepts = parseImageIdeas('not valid JSON', input);
    expect(concepts).toHaveLength(3);
    expect(new Set(concepts.map(({ prompt }) => prompt)).size).toBe(3);
    expect(concepts.every(({ prompt }) => prompt.includes('editorial') && prompt.includes('navy, gold'))).toBe(true);
  });

  test('accepts fenced model JSON only when it has the exact requested distinct concepts', () => {
    const input = imageIdeasInputSchema.parse({ prompt: 'A globe', requestedCount: 2 });
    expect(parseImageIdeas('```json\n{"concepts":[{"title":"Night","prompt":"A complete night globe composition"},{"title":"Day","prompt":"A complete day globe composition"}]}\n```', input)).toEqual([
      { title: 'Night', prompt: 'A complete night globe composition' },
      { title: 'Day', prompt: 'A complete day globe composition' },
    ]);
    expect(parseImageIdeas('{"concepts":[{"title":"Same","prompt":"Same"},{"title":"Same","prompt":"Same"}]}', input)[0]?.title).toBe('Concept 1');
  });

  test('pins idea and raw image actions to their required model routes', async () => {
    const calls: unknown[][] = [];
    const service = createImageGenerationService({ history,
      getImage: async () => null,
      execute: (async (...args: unknown[]) => {
        calls.push(args);
        return { output: { images: [{ base64: png, mimeType: 'image/png' }] }, usage: {}, costUsd: 0.12, providerId: 'openrouter', modelId: 'google.gemini-3.1-flash-lite-image', externalModelId: 'google/gemini-3.1-flash-lite-image' };
      }) as any,
      executeAsk: (async (...args: unknown[]) => { calls.push(args); return { output: { text: '{"concepts":[{"title":"Orbit","prompt":"A complete orbital image"}]}', toolCalls: [], stopReason: 'completed' }, usage: {}, providerId: 'openrouter', modelId: 'google.gemini-3.1-flash-lite-preview', externalModelId: 'google/gemini-3.1-flash-lite-preview' }; }) as any,
      now: (() => { let value = 10; return () => value += 25; })(),
    });
    await service.createRawIdeas({ prompt: 'Earth', requestedCount: 1 }, organizationKey);
    const generated = await service.generateRaw({ prompt: 'Earth', count: 1, size: '1024x1024', quality: 'high' }, organizationKey);
    expect(calls[0]?.[0]).toBe(organizationKey);
    expect(calls[0]?.[1]).not.toHaveProperty('mode');
    expect(calls[1]?.[0]).toEqual({ mode: 'auto', organizationKey, actionSlug: 'image' });
    expect(generated).toMatchObject({ durationMs: 25, costUsd: 0.12 });

    await service.generateRaw({ prompt: 'Earth', count: 1, size: '1536x1024', quality: 'low', mode: 'fast' }, organizationKey);
    expect(calls[2]?.[0]).toEqual({ mode: 'auto', organizationKey, actionSlug: 'image' });
    expect(calls[2]?.[1]).toEqual({ operation: 'generate', prompt: 'Earth', count: 1, aspectRatio: '3:2', outputFormat: 'png' });
  });

  test('persists generated bytes with deterministic Gallery idempotency and returns only safe projections', async () => {
    const processCalls: unknown[][] = [];
    let providerCalls = 0;
    const service = createImageGenerationService({ executeAsk: safeAsk, history,
      getImage: async () => null,
      execute: (async () => { providerCalls += 1; await Bun.sleep(5); return { output: { images: [{ base64: png, mimeType: 'image/png' }] }, usage: {}, costUsd: 0.2, providerId: 'openrouter', modelId: 'google.gemini-3.1-flash-lite-image', externalModelId: 'google/gemini-3.1-flash-lite-image' }; }) as any,
      process: async (inputs) => {
        processCalls.push([...inputs]);
        return inputs.map((input) => ({ key: newId(), scopeKey: input.scopeKey, filename: (input.file as any).filename, caption: 'Generated globe', imageCaptionKey: newId(), createdByKey: input.ownerKey, storageKey: 'private/storage-key', mimeType: 'image/png', sizeBytes: 8, width: 1024, height: 1024, embedding: [], isFavorite: false, createdAt: '2026-08-19T00:00:00.000Z', updatedAt: '2026-08-19T00:00:00.000Z' })) as any;
      },
      signUrl: async () => 'https://images.example/signed.png',
      now: () => 100,
      gallery: authorizedGallery,
      idempotency: claimedLedger(),
    });
    const input = { collectionKey, prompt: 'Earth', count: 1, size: '1024x1024' as const, quality: 'medium' as const };
    const [first, second] = await Promise.all([service.generate(input, context, 'request-1'), service.generate(input, context, 'request-1')]);
    expect(first).toEqual(second);
    expect(providerCalls).toBe(1);
    expect(processCalls).toHaveLength(1);
    expect(processCalls[0]?.[0]).toMatchObject({ scopeKey, ownerKey: membershipKey, idempotencyKey: expect.stringMatching(/^image-generation:[a-f0-9]{64}$/), file: { filename: 'generated-1.png', mimeType: 'image/png', sizeBytes: 8 } });
    expect(first.provider).toEqual({ durationMs: 0, costUsd: 0.2 });
    expect(first.images[0]).toMatchObject({ caption: 'Generated globe', url: 'https://images.example/signed.png' });
    expect(JSON.stringify(first)).not.toContain('base64');
    expect(JSON.stringify(first)).not.toContain('storage-key');
  });

  test('requires a trusted member and server request key before provider execution', async () => {
    let called = false;
    const service = createImageGenerationService({ executeAsk: safeAsk, history, execute: (async () => { called = true; throw new Error('unexpected'); }) as any, gallery: authorizedGallery, idempotency: claimedLedger() });
    const input = { collectionKey, prompt: 'Earth', count: 1, size: '1024x1024' as const, quality: 'low' as const };
    await expect(service.generate(input, { ...context, principal: { kind: 'system' } }, 'request-1')).rejects.toThrow('authenticated member');
    await expect(service.generate(input, context, undefined)).rejects.toThrow();
    expect(called).toBe(false);
  });

  test('authorizes Gallery persistence before claiming or invoking the provider', async () => {
    let claimed = 0, provider = 0;
    const service = createImageGenerationService({ executeAsk: safeAsk, history, gallery: { ...authorizedGallery, getCollectionRole: async () => 'viewer' }, idempotency: { ...claimedLedger(), claim: async () => { claimed += 1; return { status: 'claimed' }; } }, execute: (async () => { provider += 1; return {}; }) as any });
    await expect(service.generate({ collectionKey, prompt: 'Earth', count: 1, size: '1024x1024', quality: 'low' }, context, 'denied')).rejects.toThrow('contribution access');
    expect({ claimed, provider }).toEqual({ claimed: 0, provider: 0 });
  });

  test('invokes the image action directly without a text-model preflight', async () => {
    const calls: unknown[][] = [];
    const service = createImageGenerationService({
      history, gallery: authorizedGallery, getImage: async () => null, idempotency: claimedLedger(),
      executeAsk: (async () => { throw new Error('text action should not run'); }) as any,
      execute: (async (...args: unknown[]) => { calls.push(args); return { output: { images: [{ base64: png, mimeType: 'image/png' }] }, usage: {}, providerId: 'openrouter', modelId: 'model', externalModelId: 'model' }; }) as any,
      process: async () => [persistedImage()], signUrl: async () => 'https://images.example/generated.png',
    });
    await expect(service.generate({ collectionKey, prompt: 'request', count: 1 }, context, 'direct-image-action')).resolves.toMatchObject({ images: [{ origin: 'generated' }] });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.[0]).toEqual({ mode: 'auto', organizationKey, actionSlug: 'image' });
    expect(calls[0]?.[1]).toMatchObject({ operation: 'generate', prompt: 'request', count: 1 });
  });

  test('resolves accessible references server-side, attaches to the destination, and records history once', async () => {
    const referenceKey = newId();
    const reference = { ...persistedImage(referenceKey), caption: 'A trusted source image', storageKey: 'private/reference.png' };
    const events: unknown[][] = [];
    const service = createImageGenerationService({
      executeAsk: (async () => { throw new Error('text action should not run'); }) as any,
      execute: (async (_route: unknown, input: unknown) => { events.push(['generate', input]); return { output: { images: [{ base64: png, mimeType: 'image/png' }] }, usage: {}, providerId: 'openrouter', modelId: 'model', externalModelId: 'model' }; }) as any,
      gallery: { ...authorizedGallery, getImage: async () => reference, attachGeneratedImages: async (...args) => { events.push(['attach', ...args]); return true; } },
      resolveReference: async (storageKey, mimeType) => { events.push(['resolve', storageKey, mimeType]); return 'data:image/png;base64,iVBORw0KGgo='; },
      history: { ...history, record: async (...args: unknown[]) => { events.push(['history', ...args]); return {}; } },
      publishGeneratedImages: async (...args) => { events.push(['publish', ...args]); },
      getImage: async () => null, idempotency: claimedLedger(), process: async () => [persistedImage()], signUrl: async () => 'https://images.example/generated.png',
    });
    await service.generate({ collectionKey, prompt: 'Use this composition', referenceImageKeys: [referenceKey] }, context, 'references');
    expect(events.find(([name]) => name === 'generate')?.[1]).toMatchObject({ inputReferences: ['data:image/png;base64,iVBORw0KGgo='] });
    expect(events.some(([name]) => name === 'safety')).toBe(false);
    expect(events.filter(([name]) => name === 'attach')).toHaveLength(1);
    expect(events.filter(([name]) => name === 'history')).toHaveLength(1);
    expect(events.filter(([name]) => name === 'publish')).toEqual([['publish', collectionKey]]);
  });

  test('loads up to eight small references sequentially and bounds their aggregate data-URL payload', async () => {
    const referenceKeys = Array.from({ length: 8 }, () => newId());
    let active = 0, maximumActive = 0;
    let providerReferences: string[] = [];
    const service = createImageGenerationService({
      executeAsk: safeAsk, history, idempotency: claimedLedger(), getImage: async () => null,
      gallery: { ...authorizedGallery, getImage: async (key) => ({ ...persistedImage(key), storageKey: `references/${key}.png` }) },
      resolveReference: async (storageKey) => {
        active += 1;
        maximumActive = Math.max(maximumActive, active);
        await Bun.sleep(1);
        active -= 1;
        return `data:image/png;base64,${storageKey.slice(-4)}`;
      },
      maxReferenceDataUrlBytes: 1_000,
      execute: (async (_route: unknown, input: { inputReferences?: string[] }) => { providerReferences = input.inputReferences ?? []; return { output: { images: [{ base64: png, mimeType: 'image/png' }] }, usage: {}, providerId: 'openrouter', modelId: 'model', externalModelId: 'model' }; }) as any,
      process: async () => [persistedImage()], signUrl: async () => 'https://images.example/generated.png',
    });
    await service.generate({ collectionKey, prompt: 'Use all references', referenceImageKeys: referenceKeys }, context, 'eight-references');
    expect(providerReferences).toHaveLength(8);
    expect(maximumActive).toBe(1);

    let providerCalls = 0, resolutions = 0;
    const oversized = createImageGenerationService({
      executeAsk: safeAsk, history, idempotency: claimedLedger(), getImage: async () => null,
      gallery: { ...authorizedGallery, getImage: async (key) => ({ ...persistedImage(key), storageKey: key }) },
      resolveReference: async () => { resolutions += 1; return 'data:image/png;base64,1234567890'; },
      maxReferenceDataUrlBytes: 40,
      execute: (async () => { providerCalls += 1; return {}; }) as any,
    });
    await expect(oversized.generate({ collectionKey, prompt: 'Too large', referenceImageKeys: referenceKeys.slice(0, 2) }, context, 'oversized-references')).rejects.toMatchObject({ code: 'IMAGE_GENERATION_REFERENCES_TOO_LARGE' });
    expect(resolutions).toBe(0);
    expect(providerCalls).toBe(0);
  });

  test('separates deterministic generated-image keys for collaborators sharing an idempotency key', async () => {
    const secondMembershipKey = newId();
    const secondContext = { ...context, principal: { kind: 'member', user: { key: newId() }, userOrganization: { key: secondMembershipKey } } } as unknown as ToolContext;
    const lookupKeys: string[] = [];
    const processInputs: ProcessImageInput[] = [];
    const service = createImageGenerationService({
      executeAsk: safeAsk, history, gallery: authorizedGallery, idempotency: claimedLedger(),
      getImage: async (key) => { lookupKeys.push(key); return null; },
      execute: (async () => ({ output: { images: [{ base64: png, mimeType: 'image/png' }] }, usage: {}, providerId: 'openrouter', modelId: 'model', externalModelId: 'model' })) as any,
      process: async (inputs) => { processInputs.push(...inputs); return inputs.map((input) => ({ ...persistedImage(), createdByKey: input.ownerKey })) as any; },
      signUrl: async () => 'https://images.example/generated.png',
    });
    const input = { collectionKey, prompt: 'Shared request key' };
    await service.generate(input, context, 'same-key');
    await service.generate(input, secondContext, 'same-key');
    expect(new Set(lookupKeys).size).toBe(2);
    expect(processInputs.map(({ ownerKey }) => ownerKey)).toEqual([membershipKey, secondMembershipKey]);
    expect(processInputs.map(({ imageKey }) => imageKey)).toEqual(lookupKeys);
    expect(new Set(processInputs.map(({ idempotencyKey }) => idempotencyKey)).size).toBe(2);
  });

  test('recovers persisted images by retrying collection attachment without invoking the provider again', async () => {
    let state: 'new' | 'failed' | 'completed' = 'new';
    let failure: { retryable: boolean } | undefined;
    let expectedKey = '', providerCalls = 0, processCalls = 0, attachCalls = 0;
    let stored: ReturnType<typeof persistedImage> | undefined;
    const ledger = {
      claim: async () => state === 'completed' ? { status: 'replay' as const, response: {} } : state === 'failed' && !failure?.retryable ? { status: 'failed' as const, failure: { code: 'FAILED', message: 'failed', retryable: false } } : { status: 'claimed' as const },
      start: async () => true,
      renew: async () => true,
      complete: async () => { state = 'completed'; },
      fail: async (_identity: unknown, _hash: string, _owner: string, value: { retryable: boolean }) => { failure = value; state = 'failed'; },
      release: async () => {},
    };
    const service = createImageGenerationService({
      executeAsk: safeAsk, history, idempotency: ledger,
      gallery: { ...authorizedGallery, attachGeneratedImages: async () => ++attachCalls > 1 },
      getImage: async (key) => { expectedKey = key; return stored ?? null; },
      execute: (async () => { providerCalls += 1; return { output: { images: [{ base64: png, mimeType: 'image/png' }] }, usage: {}, providerId: 'openrouter', modelId: 'model', externalModelId: 'model' }; }) as any,
      process: async () => { processCalls += 1; return [stored = persistedImage(expectedKey)]; },
      signUrl: async () => 'https://images.example/generated.png',
    });
    const input = { collectionKey, prompt: 'Recover attachment' };
    await expect(service.generate(input, context, 'attachment-recovery')).rejects.toMatchObject({ code: 'IMAGE_IDEMPOTENCY_FAILED', retryable: true });
    await expect(service.generate(input, context, 'attachment-recovery')).resolves.toMatchObject({ images: [{ key: expectedKey }] });
    expect({ providerCalls, processCalls, attachCalls }).toEqual({ providerCalls: 1, processCalls: 1, attachCalls: 2 });
  });

  test('does not fail completed generation when prompt history cannot be recorded', async () => {
    let completed = 0;
    const service = createImageGenerationService({
      executeAsk: safeAsk,
      execute: (async () => ({ output: { images: [{ base64: png, mimeType: 'image/png' }] }, usage: {}, providerId: 'openrouter', modelId: 'model', externalModelId: 'model' })) as any,
      gallery: authorizedGallery,
      history: { ...history, record: async () => { throw new Error('history unavailable'); } },
      idempotency: { ...claimedLedger(), complete: async () => { completed += 1; } },
      getImage: async () => null,
      process: async () => [persistedImage()],
      publishGeneratedImages: async () => {},
      signUrl: async () => 'https://images.example/generated.png',
    });
    await expect(service.generate({ collectionKey, prompt: 'Earth' }, context, 'history-outage')).resolves.toMatchObject({ images: [{ caption: 'Earth' }] });
    expect(completed).toBe(1);
  });

  test('durably replays across service instances and refreshes signed URLs', async () => {
    let replay: unknown, providerCalls = 0, signCount = 0;
    const ledger = {
      claim: async () => replay ? { status: 'replay' as const, response: replay } : { status: 'claimed' as const },
      start: async () => true,
      renew: async () => true,
      complete: async (_identity: unknown, _hash: string, _owner: string, value: unknown) => { replay = value; },
      fail: async () => {},
      release: async () => {},
    };
    const dependencies = { executeAsk: safeAsk, history,
      gallery: authorizedGallery, idempotency: ledger, getImage: async () => null,
      execute: (async () => { providerCalls += 1; return { output: { images: [{ base64: png, mimeType: 'image/png' }] }, usage: {}, providerId: 'openrouter', modelId: 'model', externalModelId: 'model' }; }) as any,
      process: async () => [{ key: newId(), scopeKey, filename: 'generated.png', caption: 'Earth', imageCaptionKey: newId(), createdByKey: membershipKey, storageKey: 'durable/key.png', mimeType: 'image/png', sizeBytes: 8, width: 1024, height: 1024, embedding: [], isFavorite: false, createdAt: '2026-08-19T00:00:00.000Z', updatedAt: '2026-08-19T00:00:00.000Z' }] as any,
      signUrl: async () => `https://images.example/fresh-${++signCount}`,
    };
    const input = { collectionKey, prompt: 'Earth', count: 1, size: '1024x1024' as const, quality: 'medium' as const };
    const first = await createImageGenerationService(dependencies).generate(input, context, 'durable-request');
    const second = await createImageGenerationService(dependencies).generate(input, context, 'durable-request');
    expect(providerCalls).toBe(1);
    expect(first.images[0]!.url).not.toBe(second.images[0]!.url);
    expect(JSON.stringify(replay)).toContain('durable/key.png');
    expect(JSON.stringify(replay)).not.toContain('https://');
  });

  test('handles durable conflict and cross-instance pending claims before provider execution', async () => {
    let providerCalls = 0;
    for (const status of ['conflict', 'pending'] as const) {
      const service = createImageGenerationService({ executeAsk: safeAsk, history, gallery: authorizedGallery, idempotency: { ...claimedLedger(), claim: async () => ({ status }) }, execute: (async () => { providerCalls += 1; return {}; }) as any });
      await expect(service.generate({ collectionKey, prompt: 'Earth', count: 1, size: '1024x1024', quality: 'low' }, context, `request-${status}`)).rejects.toThrow(status === 'conflict' ? 'different request' : 'another server');
    }
    expect(providerCalls).toBe(0);
  });

  test('returns distinct indeterminate and failed image idempotency states without provider execution', async () => {
    let providerCalls = 0;
    const execute = (async () => { providerCalls += 1; return {}; }) as any;
    const indeterminate = createImageGenerationService({ executeAsk: safeAsk, history, gallery: authorizedGallery, idempotency: { ...claimedLedger(), claim: async () => ({ status: 'indeterminate' }) }, execute });
    await expect(indeterminate.generate({ collectionKey, prompt: 'Earth', count: 1, size: '1024x1024', quality: 'low' }, context, 'indeterminate')).rejects.toMatchObject({ code: 'IMAGE_IDEMPOTENCY_INDETERMINATE', retryable: false });
    const failed = createImageGenerationService({ executeAsk: safeAsk, history, gallery: authorizedGallery, idempotency: { ...claimedLedger(), claim: async () => ({ status: 'failed', failure: { code: 'IMAGE_GENERATION_FAILED', message: 'Image generation request could not be completed.', retryable: false } }) }, execute });
    await expect(failed.generate({ collectionKey, prompt: 'Earth', count: 1, size: '1024x1024', quality: 'low' }, context, 'failed')).rejects.toMatchObject({ code: 'IMAGE_IDEMPOTENCY_FAILED', retryable: false });
    expect(providerCalls).toBe(0);
  });

  test('renews the durable lease and terminalizes a sanitized execution failure', async () => {
    let renewals = 0, releases = 0, failures = 0;
    let storedFailure: unknown;
    const service = createImageGenerationService({ executeAsk: safeAsk, history,
      gallery: authorizedGallery,
      getImage: async () => null,
      idempotency: { ...claimedLedger(), renew: async () => { renewals += 1; return true; }, fail: async (_identity, _hash, _owner, failure) => { failures += 1; storedFailure = failure; }, release: async () => { releases += 1; } },
      scheduleLeaseRenewal: (renew) => { renew(); return () => {}; },
      execute: (async () => { throw new Error('provider failed'); }) as any,
    });
    await expect(service.generate({ collectionKey, prompt: 'Earth', count: 1, size: '1024x1024', quality: 'low' }, context, 'failure')).rejects.toMatchObject({ code: 'IMAGE_IDEMPOTENCY_FAILED', retryable: false });
    expect(renewals).toBeGreaterThan(0);
    expect(releases).toBe(0);
    expect(failures).toBe(1);
    expect(storedFailure).toEqual({ code: 'IMAGE_GENERATION_FAILED', message: 'Image generation request could not be completed.', retryable: false });
    expect(JSON.stringify(storedFailure)).not.toContain('provider failed');
  });

  test('leaves failed image generation indeterminate when terminal failure cannot be written', async () => {
    let state: 'new' | 'started' = 'new', providerCalls = 0;
    const ledger = {
      ...claimedLedger(),
      claim: async () => state === 'started' ? { status: 'indeterminate' as const } : { status: 'claimed' as const },
      start: async () => { state = 'started'; return true; },
      fail: async () => { throw new Error('ledger unavailable'); },
    };
    const dependencies = { executeAsk: safeAsk, history, gallery: authorizedGallery, idempotency: ledger, getImage: async () => null, execute: (async () => { providerCalls += 1; throw new Error('provider failed'); }) as any };
    const input = { collectionKey, prompt: 'Earth', count: 1, size: '1024x1024' as const, quality: 'low' as const };
    await expect(createImageGenerationService(dependencies).generate(input, context, 'failure-write')).rejects.toThrow('provider failed');
    await expect(createImageGenerationService(dependencies).generate(input, context, 'failure-write')).rejects.toMatchObject({ code: 'IMAGE_IDEMPOTENCY_INDETERMINATE', retryable: false });
    expect(providerCalls).toBe(1);
  });

  test('recovers partially persisted indices without regenerating them', async () => {
    const first = persistedImage();
    const second = persistedImage();
    let lookups = 0, providerCalls = 0, firstKey = '';
    const processed: ProcessImageInput[][] = [];
    let completed: unknown;
    const service = createImageGenerationService({ executeAsk: safeAsk, history,
      gallery: authorizedGallery,
      idempotency: { ...claimedLedger(), complete: async (_identity, _hash, _owner, value) => { completed = value; } },
      getImage: async (key) => { if (++lookups !== 1) return null; firstKey = key; return { ...first, key }; },
      execute: (async (_request: unknown, input: { count: number }) => { providerCalls += 1; expect(input.count).toBe(1); return { output: { images: [{ base64: png, mimeType: 'image/png' }] }, usage: {}, costUsd: 0.4, providerId: 'openrouter', modelId: 'model', externalModelId: 'model' }; }) as any,
      process: async (inputs) => { processed.push([...inputs]); return [second]; },
      signUrl: async (key) => `https://images.example/${key}`,
    });
    const result = await service.generate({ collectionKey, prompt: 'Earth', count: 2, size: '1024x1024', quality: 'medium' }, context, 'partial');
    expect(providerCalls).toBe(1);
    expect(processed[0]?.[0]?.idempotencyKey).toMatch(/^image-generation:[a-f0-9]{64}$/);
    expect(processed[0]?.[0]?.origin).toBe('generated');
    expect(result.images.map(({ key }) => key)).toEqual([firstKey, second.key]);
    expect(result.provider.costUsd).toBeNull();
    expect(completed).toBeDefined();
  });

  test('rejects a deterministic image owned outside the authorized owner and scope', async () => {
    let providerCalls = 0;
    const service = createImageGenerationService({ executeAsk: safeAsk, history,
      gallery: authorizedGallery,
      idempotency: claimedLedger(),
      getImage: async (key) => ({ ...persistedImage(key), createdByKey: newId() }),
      execute: (async () => { providerCalls += 1; return {}; }) as any,
    });
    await expect(service.generate({ collectionKey, prompt: 'Earth', count: 1, size: '1024x1024', quality: 'medium' }, context, 'wrong-owner')).rejects.toMatchObject({ code: 'IMAGE_IDEMPOTENCY_FAILED' });
    expect(providerCalls).toBe(0);
  });

  test('does not re-execute an ambiguous image operation after its started lease expires', async () => {
    let stored: any, providerCalls = 0, processCalls = 0, completions = 0, releases = 0, failures = 0;
    let state: 'new' | 'claimed' | 'started' = 'new';
    let beyondLease = false;
    const ledger = {
      claim: async () => {
        if (state === 'new' || state === 'claimed' && beyondLease) { state = 'claimed'; return { status: 'claimed' as const }; }
        return { status: 'pending' as const };
      },
      start: async () => { state = 'started'; return true; },
      renew: async () => true,
      complete: async () => { completions += 1; if (completions === 1) throw new Error('ledger completion failed'); },
      fail: async () => { failures += 1; },
      release: async () => { releases += 1; },
    };
    const dependencies = { executeAsk: safeAsk, history,
      gallery: authorizedGallery, idempotency: ledger,
      getImage: async (key: string) => { if (!stored) return null; stored = { ...stored, key }; return stored; },
      execute: (async () => { providerCalls += 1; return { output: { images: [{ base64: png, mimeType: 'image/png' }] }, usage: {}, costUsd: 0.2, providerId: 'openrouter', modelId: 'model', externalModelId: 'model' }; }) as any,
      process: async () => { processCalls += 1; stored = persistedImage(); return [stored]; },
      signUrl: async () => 'https://images.example/refreshed.png',
    };
    const input = { collectionKey, prompt: 'Earth', count: 1, size: '1024x1024' as const, quality: 'medium' as const };
    await expect(createImageGenerationService(dependencies).generate(input, context, 'completion-recovery')).rejects.toThrow('ledger completion failed');
    beyondLease = true;
    await expect(createImageGenerationService(dependencies).generate(input, context, 'completion-recovery')).rejects.toThrow('another server');
    expect({ providerCalls, processCalls, completions, releases, failures }).toEqual({ providerCalls: 1, processCalls: 1, completions: 1, releases: 0, failures: 0 });
    expect(state as 'new' | 'claimed' | 'started').toBe('started');
  });
});
