import { describe, expect, test } from 'bun:test';
import { newId } from '@/lib/ids';
import type { ToolContext } from '@/lib/ai/tools/tool-context';
import type { ProcessImageInput } from '@/lib/ai/image-processing';
import { createImageGenerationService, imageGenerateModelInputSchema, imageIdeasInputSchema, parseImageIdeas } from './service';

const organizationKey = newId(), scopeKey = newId(), membershipKey = newId();
const context = {
  organizationKey,
  runtimeScopeKey: scopeKey,
  principal: { kind: 'member', user: { key: newId() }, userOrganization: { key: membershipKey } },
} as unknown as ToolContext;

const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).toString('base64');
const authorizedGallery = { canManageScope: async () => true };
const claimedLedger = () => ({ claim: async () => ({ status: 'claimed' as const }), renew: async () => true, complete: async () => {}, release: async () => {} });
const persistedImage = (key = newId()) => ({ key, scopeKey, filename: 'generated.png', caption: 'Earth', imageCaptionKey: newId(), createdByKey: membershipKey, storageKey: `durable/${key}.png`, mimeType: 'image/png', sizeBytes: 8, width: 1024, height: 1024, embedding: [], isFavorite: false, createdAt: '2026-08-19T00:00:00.000Z', updatedAt: '2026-08-19T00:00:00.000Z' }) as any;

describe('image generation service', () => {
  test('uses strict bounded contracts and an exact distinct fallback', () => {
    expect(() => imageIdeasInputSchema.parse({ prompt: 'A globe', requestedCount: 2, organizationKey })).toThrow('Unrecognized key');
    expect(() => imageIdeasInputSchema.parse({ prompt: 'A globe', requestedCount: 9 })).toThrow();
    expect(() => imageGenerateModelInputSchema.parse({ prompt: 'A globe', count: 1, size: '512x512', quality: 'high' })).toThrow();
    expect(imageGenerateModelInputSchema.parse({ prompt: 'A globe', count: 1, size: '1024x1024', quality: 'high' }).mode).toBe('default');
    expect(imageGenerateModelInputSchema.parse({ prompt: 'A globe', count: 1, size: '1536x1024', quality: 'low', mode: 'fast' }).mode).toBe('fast');
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
    const service = createImageGenerationService({
      getImage: async () => null,
      execute: (async (...args: unknown[]) => {
        calls.push(args);
        const request = args[0] as { actionSlug: string };
        return request.actionSlug === 'ask'
          ? { output: { text: '{"concepts":[{"title":"Orbit","prompt":"A complete orbital image"}]}', toolCalls: [], stopReason: 'completed' }, usage: {}, providerId: 'openai', modelId: 'openai.gpt-5.6-luna', externalModelId: 'gpt-5.6-luna' }
          : { output: { images: [{ base64: png, mimeType: 'image/png' }] }, usage: {}, costUsd: 0.12, providerId: 'openai', modelId: 'openai.gpt-image-2', externalModelId: 'gpt-image-2' };
      }) as any,
      now: (() => { let value = 10; return () => value += 25; })(),
    });
    await service.createRawIdeas({ prompt: 'Earth', requestedCount: 1 }, organizationKey);
    const generated = await service.generateRaw({ prompt: 'Earth', count: 1, size: '1024x1024', quality: 'high' }, organizationKey);
    expect(calls[0]?.[0]).toEqual({ mode: 'fixed', organizationKey, actionSlug: 'ask', modelSlug: 'openai.gpt-5.6-luna', providerSlug: 'openai' });
    expect(calls[1]?.[0]).toEqual({ mode: 'fixed', organizationKey, actionSlug: 'generate-image', modelSlug: 'openai.gpt-image-2', providerSlug: 'openai' });
    expect(generated).toMatchObject({ durationMs: 25, costUsd: 0.12 });

    await service.generateRaw({ prompt: 'Earth', count: 1, size: '1536x1024', quality: 'low', mode: 'fast' }, organizationKey);
    expect(calls[2]?.[0]).toEqual({ mode: 'fixed', organizationKey, actionSlug: 'generate-image', modelSlug: 'bfl.flux-2-klein-4b', providerSlug: 'openrouter' });
    expect(calls[2]?.[1]).toEqual({ prompt: 'Earth', count: 1, aspectRatio: '3:2', outputFormat: 'png' });
  });

  test('persists generated bytes with deterministic Gallery idempotency and returns only safe projections', async () => {
    const processCalls: unknown[][] = [];
    let providerCalls = 0;
    const service = createImageGenerationService({
      getImage: async () => null,
      execute: (async () => { providerCalls += 1; await Bun.sleep(5); return { output: { images: [{ base64: png, mimeType: 'image/png' }] }, usage: {}, costUsd: 0.2, providerId: 'openai', modelId: 'openai.gpt-image-2', externalModelId: 'gpt-image-2' }; }) as any,
      process: async (inputs) => {
        processCalls.push([...inputs]);
        return inputs.map((input) => ({ key: newId(), scopeKey: input.scopeKey, filename: (input.file as any).filename, caption: 'Generated globe', imageCaptionKey: newId(), createdByKey: input.ownerKey, storageKey: 'private/storage-key', mimeType: 'image/png', sizeBytes: 8, width: 1024, height: 1024, embedding: [], isFavorite: false, createdAt: '2026-08-19T00:00:00.000Z', updatedAt: '2026-08-19T00:00:00.000Z' })) as any;
      },
      signUrl: async () => 'https://images.example/signed.png',
      now: () => 100,
      gallery: authorizedGallery,
      idempotency: claimedLedger(),
    });
    const input = { prompt: 'Earth', count: 1, size: '1024x1024' as const, quality: 'medium' as const };
    const [first, second] = await Promise.all([service.generate(input, context, 'request-1'), service.generate(input, context, 'request-1')]);
    expect(first).toEqual(second);
    expect(providerCalls).toBe(1);
    expect(processCalls).toHaveLength(1);
    expect(processCalls[0]?.[0]).toMatchObject({ scopeKey, ownerKey: membershipKey, idempotencyKey: 'request-1:0', file: { filename: 'generated-1.png', mimeType: 'image/png', sizeBytes: 8 } });
    expect(first.provider).toEqual({ durationMs: 0, costUsd: 0.2 });
    expect(first.images[0]).toMatchObject({ caption: 'Generated globe', url: 'https://images.example/signed.png' });
    expect(JSON.stringify(first)).not.toContain('base64');
    expect(JSON.stringify(first)).not.toContain('storage-key');
  });

  test('requires a trusted member and server request key before provider execution', async () => {
    let called = false;
    const service = createImageGenerationService({ execute: (async () => { called = true; throw new Error('unexpected'); }) as any, gallery: authorizedGallery, idempotency: claimedLedger() });
    const input = { prompt: 'Earth', count: 1, size: '1024x1024' as const, quality: 'low' as const };
    await expect(service.generate(input, { ...context, principal: { kind: 'system' } }, 'request-1')).rejects.toThrow('authenticated member');
    await expect(service.generate(input, context, undefined)).rejects.toThrow();
    expect(called).toBe(false);
  });

  test('authorizes Gallery persistence before claiming or invoking the provider', async () => {
    let claimed = 0, provider = 0;
    const service = createImageGenerationService({ gallery: { canManageScope: async () => false }, idempotency: { ...claimedLedger(), claim: async () => { claimed += 1; return { status: 'claimed' }; } }, execute: (async () => { provider += 1; return {}; }) as any });
    await expect(service.generate({ prompt: 'Earth', count: 1, size: '1024x1024', quality: 'low' }, context, 'denied')).rejects.toThrow('write access');
    expect({ claimed, provider }).toEqual({ claimed: 0, provider: 0 });
  });

  test('durably replays across service instances and refreshes signed URLs', async () => {
    let replay: unknown, providerCalls = 0, signCount = 0;
    const ledger = {
      claim: async () => replay ? { status: 'replay' as const, response: replay } : { status: 'claimed' as const },
      renew: async () => true,
      complete: async (_identity: unknown, _hash: string, _owner: string, value: unknown) => { replay = value; },
      release: async () => {},
    };
    const dependencies = {
      gallery: authorizedGallery, idempotency: ledger, getImage: async () => null,
      execute: (async () => { providerCalls += 1; return { output: { images: [{ base64: png, mimeType: 'image/png' }] }, usage: {}, providerId: 'openai', modelId: 'model', externalModelId: 'model' }; }) as any,
      process: async () => [{ key: newId(), scopeKey, filename: 'generated.png', caption: 'Earth', imageCaptionKey: newId(), createdByKey: membershipKey, storageKey: 'durable/key.png', mimeType: 'image/png', sizeBytes: 8, width: 1024, height: 1024, embedding: [], isFavorite: false, createdAt: '2026-08-19T00:00:00.000Z', updatedAt: '2026-08-19T00:00:00.000Z' }] as any,
      signUrl: async () => `https://images.example/fresh-${++signCount}`,
    };
    const input = { prompt: 'Earth', count: 1, size: '1024x1024' as const, quality: 'medium' as const };
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
      const service = createImageGenerationService({ gallery: authorizedGallery, idempotency: { ...claimedLedger(), claim: async () => ({ status }) }, execute: (async () => { providerCalls += 1; return {}; }) as any });
      await expect(service.generate({ prompt: 'Earth', count: 1, size: '1024x1024', quality: 'low' }, context, `request-${status}`)).rejects.toThrow(status === 'conflict' ? 'different request' : 'another server');
    }
    expect(providerCalls).toBe(0);
  });

  test('renews the durable lease while work runs and releases it after failure', async () => {
    let renewals = 0, releases = 0;
    const service = createImageGenerationService({
      gallery: authorizedGallery,
      getImage: async () => null,
      idempotency: { ...claimedLedger(), renew: async () => { renewals += 1; return true; }, release: async () => { releases += 1; } },
      scheduleLeaseRenewal: (renew) => { renew(); return () => {}; },
      execute: (async () => { throw new Error('provider failed'); }) as any,
    });
    await expect(service.generate({ prompt: 'Earth', count: 1, size: '1024x1024', quality: 'low' }, context, 'failure')).rejects.toThrow();
    expect(renewals).toBeGreaterThan(0);
    expect(releases).toBe(1);
  });

  test('recovers partially persisted indices without regenerating them', async () => {
    const first = persistedImage();
    const second = persistedImage();
    let lookups = 0, providerCalls = 0, firstKey = '';
    const processed: ProcessImageInput[][] = [];
    let completed: unknown;
    const service = createImageGenerationService({
      gallery: authorizedGallery,
      idempotency: { ...claimedLedger(), complete: async (_identity, _hash, _owner, value) => { completed = value; } },
      getImage: async (key) => { if (++lookups !== 1) return null; firstKey = key; return { ...first, key }; },
      execute: (async (_request: unknown, input: { count: number }) => { providerCalls += 1; expect(input.count).toBe(1); return { output: { images: [{ base64: png, mimeType: 'image/png' }] }, usage: {}, costUsd: 0.4, providerId: 'openai', modelId: 'model', externalModelId: 'model' }; }) as any,
      process: async (inputs) => { processed.push([...inputs]); return [second]; },
      signUrl: async (key) => `https://images.example/${key}`,
    });
    const result = await service.generate({ prompt: 'Earth', count: 2, size: '1024x1024', quality: 'medium' }, context, 'partial');
    expect(providerCalls).toBe(1);
    expect(processed[0]?.[0]?.idempotencyKey).toBe('partial:1');
    expect(result.images.map(({ key }) => key)).toEqual([firstKey, second.key]);
    expect(result.provider.costUsd).toBeNull();
    expect(completed).toBeDefined();
  });

  test('rejects a deterministic image owned outside the authorized owner and scope', async () => {
    let providerCalls = 0;
    const service = createImageGenerationService({
      gallery: authorizedGallery,
      idempotency: claimedLedger(),
      getImage: async (key) => ({ ...persistedImage(key), createdByKey: newId() }),
      execute: (async () => { providerCalls += 1; return {}; }) as any,
    });
    await expect(service.generate({ prompt: 'Earth', count: 1, size: '1024x1024', quality: 'medium' }, context, 'wrong-owner')).rejects.toThrow('unavailable to this owner and scope');
    expect(providerCalls).toBe(0);
  });

  test('recovers all persisted images after ledger completion failure without another provider call', async () => {
    let stored: any, providerCalls = 0, processCalls = 0, completions = 0, releases = 0;
    const ledger = {
      claim: async () => ({ status: 'claimed' as const }), renew: async () => true,
      complete: async () => { completions += 1; if (completions === 1) throw new Error('ledger completion failed'); },
      release: async () => { releases += 1; },
    };
    const dependencies = {
      gallery: authorizedGallery, idempotency: ledger,
      getImage: async (key: string) => { if (!stored) return null; stored = { ...stored, key }; return stored; },
      execute: (async () => { providerCalls += 1; return { output: { images: [{ base64: png, mimeType: 'image/png' }] }, usage: {}, costUsd: 0.2, providerId: 'openai', modelId: 'model', externalModelId: 'model' }; }) as any,
      process: async () => { processCalls += 1; stored = persistedImage(); return [stored]; },
      signUrl: async () => 'https://images.example/refreshed.png',
    };
    const input = { prompt: 'Earth', count: 1, size: '1024x1024' as const, quality: 'medium' as const };
    await expect(createImageGenerationService(dependencies).generate(input, context, 'completion-recovery')).rejects.toThrow('ledger completion failed');
    const recovered = await createImageGenerationService(dependencies).generate(input, context, 'completion-recovery');
    expect({ providerCalls, processCalls, completions, releases }).toEqual({ providerCalls: 1, processCalls: 1, completions: 2, releases: 1 });
    expect(recovered).toMatchObject({ images: [{ key: stored.key, url: 'https://images.example/refreshed.png' }], provider: { durationMs: 0, costUsd: null } });
  });
});
