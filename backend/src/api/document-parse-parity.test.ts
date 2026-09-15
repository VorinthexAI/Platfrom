import { expect, test } from 'bun:test';
import { Hono } from 'hono';
import sharp from 'sharp';
import { createContentToolHandler } from './content-tools';
import { runTool } from '@/lib/ai/tools';
import type { ToolContext } from '@/lib/ai/tools/tool-context';
import type { ContentToolDependencies } from '@/lib/ai/tools/content-runtime';
import { recordActionCost, recordActionUsage } from '@/lib/ai/events/runtime';
import { calculateActionCostMicroSparks } from '@/lib/costs';
import { EMBEDDING_DIMENSIONS } from '@/lib/embeddings';
import { newId } from '@/lib/ids';

test('HTTP and Core parse both file and pages through one service with actual-action billing and replay', async () => {
  const userKey = newId(), teamKey = newId(), scopeKey = newId(), memberKey = newId();
  const context = { teamKey, runtimeScopeKey: scopeKey, principal: { kind: 'member', user: { key: userKey }, userTeam: { key: memberKey, userId: userKey, teamKey, teamRole: 'owner', status: 'active' } } } as unknown as ToolContext;
  const documents = new Map<string, any>(), receipts = new Map<string, { hash: string; result?: unknown; failure?: { code: string; message: string; retryable: boolean } }>();
  const sources: string[] = [], charges: any[] = [];
  let authorized = true;
  const usage = { inputTokens: 111, outputTokens: 25, totalTokens: 136 };
  const dependencies: ContentToolDependencies = {
    repository: { getScope: async (key: string) => authorized && key === scopeKey ? { key, teamKey } : null, role: async () => 'owner', getFolder: async () => null, getDocument: async (key: string) => documents.get(key) ?? null, insertDocument: async (document: any) => { documents.set(document.key, document); return document; } } as never,
    storage: { upload: async ({ key }) => ({ storageKey: key }), delete: async () => undefined, download: async () => ({ bytes: new Uint8Array() }), copy: async ({ destinationKey }) => ({ storageKey: destinationKey }) },
    ingestion: { embedBatch: async ({ texts }) => texts.map(() => Array(EMBEDDING_DIMENSIONS).fill(0.1)), transcribe: async (source, trusted) => {
      expect(trusted.teamKey).toBe(teamKey);
      await recordActionCost('text'); await recordActionUsage('text', {}, usage);
      sources.push(source.type);
      return { text: 'Invoice total: €42.00' };
    } },
    idempotency: {
      claim: async (identity, hash) => { const current = receipts.get(identity.idempotencyKey); if (!current) { receipts.set(identity.idempotencyKey, { hash }); return { status: 'claimed' }; } return current.hash !== hash ? { status: 'conflict' } : current.failure ? { status: 'failed', failure: current.failure } : current.result ? { status: 'replay', response: current.result } : { status: 'pending' }; },
      start: async () => true,
      complete: async (identity, hash, _owner, result) => { receipts.set(identity.idempotencyKey, { hash, result }); },
      fail: async (identity, hash, _owner, failure) => { receipts.set(identity.idempotencyKey, { hash, failure }); }, release: async () => undefined,
    },
  };
  let funded = true;
  const billing = { getBalance: async () => funded ? 100_000_000 : 0, charge: async (_user: string, input: any) => { charges.push(input); return { status: 'applied', transaction: { key: newId() } } as never; } };
  const appScopeKey = newId();
  const app = new Hono().post('/content/tools/:tool', createContentToolHandler({
    getIdentity: async () => ({ key: userKey, identityType: 'user' }),
    serviceOptions: { resolveMembership: async () => context.principal.kind === 'member' ? context.principal.userTeam : null, resolveUser: async () => ({ key: userKey }) as never, authorizeScope: async () => ({ allowed: authorized }) as never, contentDependencies: dependencies, billing, recordEvent: async () => {}, appScopeKey },
  }));
  const pdf = new TextEncoder().encode('%PDF-1.4\n%%EOF');
  const png = new Uint8Array(await sharp({ create: { width: 16, height: 16, channels: 3, background: 'white' } }).png().toBuffer());
  const file = { filename: 'source.pdf', mimeType: 'application/pdf', sizeBytes: pdf.length, bytes: pdf };
  const page = { filename: 'page.png', mimeType: 'image/png', sizeBytes: png.length, bytes: png };
  const toWire = ({ bytes, ...source }: typeof file) => ({ ...source, encoding: 'base64', content: Buffer.from(bytes).toString('base64') });
  const http = (input: unknown, requestKey: string, tool = 'document.parse') => app.request(`/content/tools/${tool}`, { method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': requestKey }, body: JSON.stringify({ teamKey, scopeKey, input }) });
  expect((await http({ scopeKey, file: toWire(file) }, 'http-file')).status).toBe(200);
  await runTool('document.parse', '', { file }, { contentContext: context, contentDependencies: dependencies, requestKey: 'core-file', billing, recordEvent: async () => {}, appScopeKey });
  expect((await http({ scopeKey, pages: [toWire(page)] }, 'http-pages')).status).toBe(200);
  await runTool('document.parse', '', { pages: [page] }, { contentContext: context, contentDependencies: dependencies, requestKey: 'core-pages', billing, recordEvent: async () => {}, appScopeKey });
  expect(sources).toEqual(['file', 'file', 'image', 'image']);
  expect(charges).toHaveLength(4);
  expect(charges.every((charge) => charge.kind === 'action' && charge.actionSlug === 'text' && charge.microSparks === calculateActionCostMicroSparks('text', usage))).toBe(true);
  expect((await http({ scopeKey, pages: [toWire(page), toWire(page)] }, 'http-multiple-pages')).status).toBe(200);
  expect(charges).toHaveLength(6);
  expect((await http({ scopeKey, pages: [toWire(page), toWire(page)] }, 'http-multiple-pages')).status).toBe(200);
  expect(charges).toHaveLength(6);
  expect((await http({ scopeKey, file: toWire(file) }, 'http-file')).status).toBe(200);
  expect(charges).toHaveLength(6);
  expect((await http({ scopeKey, file: toWire(file), pages: [toWire(page)] }, 'invalid-mixed')).status).toBe(400);
  expect((await http({ scopeKey, pages: [toWire(page)] }, 'retired-tool', 'document.scan')).status).toBe(400);
  funded = false;
  expect((await http({ scopeKey, file: toWire(file) }, 'unfunded-file')).status).toBe(402);
  expect((await http({ scopeKey, pages: [toWire(page)] }, 'unfunded-pages')).status).toBe(402);
  expect((await http({ scopeKey, file: toWire(file) }, 'unfunded-file')).status).toBe(402);
  expect(documents.size).toBe(5);
  expect(charges).toHaveLength(6);
  authorized = false;
  expect((await http({ scopeKey, file: toWire(file) }, 'unauthorized')).status).toBe(403);
  await expect(runTool('document.parse', '', { file }, { contentContext: context, contentDependencies: dependencies, requestKey: 'unauthorized-core', billing, recordEvent: async () => {}, appScopeKey })).rejects.toThrow();
  expect(charges).toHaveLength(6);
});
