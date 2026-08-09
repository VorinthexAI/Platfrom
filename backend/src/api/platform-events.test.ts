import { describe, expect, test } from 'bun:test';
import { Hono } from 'hono';
import { appEventBodySchema, createPlatformEventHandler } from './platform-events';

const distinctId = 'app_12345678-1234-4234-9234-123456789012';
const eventId = 'evt_12345678-1234-4234-9234-123456789012';

describe('POST /platform/events', () => {
  test('accepts only the two app-prefixed event contracts', () => {
    expect(appEventBodySchema.parse({ slug: 'app.opened', eventId, distinctId })).toEqual({ slug: 'app.opened', eventId, distinctId });
    expect(appEventBodySchema.parse({ slug: 'app.onboarding', eventId, distinctId, step: 1, coreAppName: 'Archive', enabled: true, skipped: false }).slug).toBe('app.onboarding');
    expect(() => appEventBodySchema.parse({ slug: 'opened', distinctId })).toThrow();
    expect(() => appEventBodySchema.parse({ slug: 'app.opened', distinctId, step: 1 })).toThrow();
    expect(() => appEventBodySchema.parse({ slug: 'app.onboarding', distinctId, step: 6, coreAppName: 'Archive', enabled: true, skipped: false })).toThrow();
    expect(() => appEventBodySchema.parse({ slug: 'app.onboarding', distinctId, step: 1, coreAppName: 'Core', enabled: true, skipped: false })).toThrow();
    expect(() => appEventBodySchema.parse({ slug: 'app.onboarding', distinctId, step: 1, coreAppName: 'Archive', enabled: true, skipped: true })).toThrow();
  });

  test('persists the installation and authenticated user identity', async () => {
    const inserted: Record<string, unknown>[] = [];
    const app = new Hono().post('/platform/events', createPlatformEventHandler({
      getIdentity: async () => ({ key: 'user-1', identityType: 'user' }),
      insert: async (event) => {
        inserted.push(event);
        return { ...event, data: event.data ?? null, userId: event.userId ?? null, embedding: [] };
      },
    }));
    const response = await app.request('/platform/events', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ slug: 'app.onboarding', eventId, distinctId, step: 5, coreAppName: 'Ascend', enabled: false, skipped: true }),
    });
    expect(response.status).toBe(202);
    expect(inserted[0]).toMatchObject({
      key: eventId, slug: 'app.onboarding', distinctId, userId: 'user-1',
      data: { step: 5, coreAppName: 'Ascend', enabled: false, skipped: true },
    });
  });

  test('acknowledges a retried event without overwriting the first record', async () => {
    const app = new Hono().post('/platform/events', createPlatformEventHandler({
      getIdentity: async () => null,
      insert: async () => { throw { errorNum: 1210 }; },
    }));
    const response = await app.request('/platform/events', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ slug: 'app.opened', eventId, distinctId }),
    });
    expect(response.status).toBe(202);
  });
});
