import { describe, expect, test } from 'bun:test';
import { Hono } from 'hono';
import { createPolarWebhookHandler, POLAR_WEBHOOK_MAX_BODY_BYTES } from './polar-webhook';

const event = { type: 'order.paid', data: { id: 'order-1' } };

describe('Polar webhook protocol boundary', () => {
  test('verifies raw body, claims, durably enqueues, and acknowledges', async () => {
    const calls: string[] = []; const app = new Hono();
    app.post('/webhook', createPolarWebhookHandler({ verify: ({ rawBody }) => { calls.push(rawBody); return event; }, claim: async () => 'claimed', enqueue: async () => { calls.push('enqueued'); } }));
    const response = await app.request('/webhook', { method: 'POST', headers: { 'webhook-id': 'event-1' }, body: JSON.stringify(event) });
    expect(response.status).toBe(202);
    expect(calls).toEqual([JSON.stringify(event), 'enqueued']);
  });

  test('rejects oversized declared and streamed bodies before verification', async () => {
    let verified = 0;
    const app = new Hono();
    app.post('/webhook', createPolarWebhookHandler({ verify: () => { verified += 1; return event; } }));
    expect((await app.request('/webhook', { method: 'POST', headers: { 'content-length': String(POLAR_WEBHOOK_MAX_BODY_BYTES + 1) }, body: '{}' })).status).toBe(413);
    const stream = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new Uint8Array(POLAR_WEBHOOK_MAX_BODY_BYTES)); controller.enqueue(new Uint8Array(1)); controller.close(); } });
    expect((await app.request(new Request('http://localhost/webhook', { method: 'POST', body: stream, duplex: 'half' } as RequestInit))).status).toBe(413);
    expect(verified).toBe(0);
  });

  test('acknowledges completed duplicates and releases failed claims for retry', async () => {
    const duplicate = new Hono(); duplicate.post('/webhook', createPolarWebhookHandler({ verify: () => event, claim: async () => 'duplicate' }));
    expect(await (await duplicate.request('/webhook', { method: 'POST', headers: { 'webhook-id': 'event-1' } })).json()).toEqual({ ok: true, duplicate: true });
    let released = false; const failed = new Hono(); failed.onError((error, c) => c.json({ error: error.message }, 500));
    failed.post('/webhook', createPolarWebhookHandler({ verify: () => event, claim: async () => 'claimed', enqueue: async () => { throw new Error('redis unavailable'); }, release: async () => { released = true; } }));
    expect((await failed.request('/webhook', { method: 'POST', headers: { 'webhook-id': 'event-2' } })).status).toBe(500);
    expect(released).toBe(true);
  });

  test('reasserts durable queue state for an in-progress claim', async () => {
    let enqueued = 0; let released = false;
    const app = new Hono();
    app.post('/webhook', createPolarWebhookHandler({ verify: () => event, claim: async () => 'in_progress', enqueue: async () => { enqueued += 1; }, release: async () => { released = true; } }));
    const response = await app.request('/webhook', { method: 'POST', headers: { 'webhook-id': 'event-1' } });
    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({ ok: true, pending: true });
    expect(enqueued).toBe(1);
    expect(released).toBe(false);
  });
});
