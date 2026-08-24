import { describe, expect, test } from 'bun:test';
import { Hono } from 'hono';
import { createGmailWebhookHandler, isGmailWebhookPath } from './email-webhook';
import { processEmailSyncJob } from '@/lib/email-inbox/sync-queue';

const payload = { emailAddress: 'Person@Example.com', historyId: '1234' };
const envelope = { message: { data: Buffer.from(JSON.stringify(payload)).toString('base64'), messageId: 'message-1', publishTime: '2026-08-11T12:00:00.000Z', orderingKey: 'account-1' }, subscription: 'projects/project/subscriptions/gmail' };

describe('Gmail Pub/Sub webhook', () => {
  test('recognizes only the exact webhook path', () => {
    expect(isGmailWebhookPath('/api/v1/webhooks/gmail/pubsub')).toBe(true);
    expect(isGmailWebhookPath('/api/v1/webhooks/gmail/pubsub/')).toBe(true);
    expect(isGmailWebhookPath('/api/webhooks/gmail/pubsub')).toBe(false);
  });

  test('accepts the official camelCase payload and durably enqueues a strict notification', async () => {
    let queued: unknown;
    const handler = createGmailWebhookHandler({ verify: async () => ({ subject: 'service', email: 'push@example.com' }), enqueue: async (input) => { queued = input; return { jobId: 'job-1' }; } });
    const app = new Hono().post('/hook', handler);
    const previousAudience = process.env.GMAIL_PUBSUB_PUSH_AUDIENCE;
    const previousEmail = process.env.GMAIL_PUBSUB_PUSH_SERVICE_ACCOUNT_EMAIL;
    const previousSubscription = process.env.GMAIL_PUBSUB_SUBSCRIPTION;
    process.env.GMAIL_PUBSUB_PUSH_AUDIENCE = 'audience'; process.env.GMAIL_PUBSUB_PUSH_SERVICE_ACCOUNT_EMAIL = 'push@example.com'; process.env.GMAIL_PUBSUB_SUBSCRIPTION = envelope.subscription;
    try {
      const response = await app.request('/hook', { method: 'POST', headers: { authorization: 'Bearer signed', 'content-type': 'application/json' }, body: JSON.stringify(envelope) });
      expect(response.status).toBe(204);
      expect(queued).toEqual({ emailAddress: payload.emailAddress, historyId: '1234', messageId: 'message-1', subscription: envelope.subscription, publishTime: envelope.message.publishTime });
    } finally {
      if (previousAudience === undefined) delete process.env.GMAIL_PUBSUB_PUSH_AUDIENCE; else process.env.GMAIL_PUBSUB_PUSH_AUDIENCE = previousAudience;
      if (previousEmail === undefined) delete process.env.GMAIL_PUBSUB_PUSH_SERVICE_ACCOUNT_EMAIL; else process.env.GMAIL_PUBSUB_PUSH_SERVICE_ACCOUNT_EMAIL = previousEmail;
      if (previousSubscription === undefined) delete process.env.GMAIL_PUBSUB_SUBSCRIPTION; else process.env.GMAIL_PUBSUB_SUBSCRIPTION = previousSubscription;
    }
  });

  test('normalizes the documented snake_case message aliases', async () => {
    let queued: unknown;
    const handler = createGmailWebhookHandler({ verify: async () => ({ subject: 'service', email: 'push@example.com' }), enqueue: async (input) => { queued = input; return { jobId: 'job-1' }; } });
    const app = new Hono().post('/hook', handler);
    const previous = { audience: process.env.GMAIL_PUBSUB_PUSH_AUDIENCE, email: process.env.GMAIL_PUBSUB_PUSH_SERVICE_ACCOUNT_EMAIL, subscription: process.env.GMAIL_PUBSUB_SUBSCRIPTION };
    process.env.GMAIL_PUBSUB_PUSH_AUDIENCE = 'audience'; process.env.GMAIL_PUBSUB_PUSH_SERVICE_ACCOUNT_EMAIL = 'push@example.com'; process.env.GMAIL_PUBSUB_SUBSCRIPTION = envelope.subscription;
    const snakeEnvelope = { ...envelope, message: { data: envelope.message.data, message_id: 'message-snake', publish_time: envelope.message.publishTime, ordering_key: 'account-1' } };
    try {
      const response = await app.request('/hook', { method: 'POST', headers: { authorization: 'Bearer signed', 'content-type': 'application/json' }, body: JSON.stringify(snakeEnvelope) });
      expect(response.status).toBe(204);
      expect(queued).toEqual({ emailAddress: payload.emailAddress, historyId: payload.historyId, messageId: 'message-snake', subscription: envelope.subscription, publishTime: envelope.message.publishTime });
    } finally {
      if (previous.audience === undefined) delete process.env.GMAIL_PUBSUB_PUSH_AUDIENCE; else process.env.GMAIL_PUBSUB_PUSH_AUDIENCE = previous.audience;
      if (previous.email === undefined) delete process.env.GMAIL_PUBSUB_PUSH_SERVICE_ACCOUNT_EMAIL; else process.env.GMAIL_PUBSUB_PUSH_SERVICE_ACCOUNT_EMAIL = previous.email;
      if (previous.subscription === undefined) delete process.env.GMAIL_PUBSUB_SUBSCRIPTION; else process.env.GMAIL_PUBSUB_SUBSCRIPTION = previous.subscription;
    }
  });

  test('carries Pub/Sub enqueue data through the worker to canonical service.sync', async () => {
    let queued: any, synced: unknown[] = [];
    const connectorJobs: unknown[] = [];
    const handler = createGmailWebhookHandler({ verify: async () => ({ subject: 'service', email: 'push@example.com' }), enqueue: async (input) => { queued = { schemaVersion: 1, kind: 'notification', ...input }; return { jobId: 'job-1' }; } });
    const app = new Hono().post('/hook', handler);
    const previous = { audience: process.env.GMAIL_PUBSUB_PUSH_AUDIENCE, email: process.env.GMAIL_PUBSUB_PUSH_SERVICE_ACCOUNT_EMAIL, subscription: process.env.GMAIL_PUBSUB_SUBSCRIPTION };
    process.env.GMAIL_PUBSUB_PUSH_AUDIENCE = 'audience'; process.env.GMAIL_PUBSUB_PUSH_SERVICE_ACCOUNT_EMAIL = 'push@example.com'; process.env.GMAIL_PUBSUB_SUBSCRIPTION = envelope.subscription;
    try {
      expect((await app.request('/hook', { method: 'POST', headers: { authorization: 'Bearer signed', 'content-type': 'application/json' }, body: JSON.stringify(envelope) })).status).toBe(204);
      await processEmailSyncJob(queued, {
        connectors: { listSyncTargetsByEmail: async () => [{ organizationKey: 'org-1', scopeKey: 'cmrnlzf640001qc7kazsr96k5', connectorKey: 'cmrnlzf650002qc7k4p5zem5w' }] } as never,
        queue: { add: async (_name: string, job: unknown) => { connectorJobs.push(job); return {} as never; } },
      });
      expect(connectorJobs).toHaveLength(1);
      await processEmailSyncJob(connectorJobs[0], { service: { sync: async (...args: unknown[]) => { synced.push(args); return {}; } } as never });
      expect(synced).toEqual([[{ userKey: 'system', organizationKey: 'org-1', scopeKey: 'cmrnlzf640001qc7kazsr96k5' }, 'cmrnlzf650002qc7k4p5zem5w']]);
    } finally {
      if (previous.audience === undefined) delete process.env.GMAIL_PUBSUB_PUSH_AUDIENCE; else process.env.GMAIL_PUBSUB_PUSH_AUDIENCE = previous.audience;
      if (previous.email === undefined) delete process.env.GMAIL_PUBSUB_PUSH_SERVICE_ACCOUNT_EMAIL; else process.env.GMAIL_PUBSUB_PUSH_SERVICE_ACCOUNT_EMAIL = previous.email;
      if (previous.subscription === undefined) delete process.env.GMAIL_PUBSUB_SUBSCRIPTION; else process.env.GMAIL_PUBSUB_SUBSCRIPTION = previous.subscription;
    }
  });

  test('rejects missing authentication and unknown payload fields', async () => {
    const handler = createGmailWebhookHandler({ verify: async () => ({ subject: 'service', email: 'push@example.com' }), enqueue: async () => ({ jobId: 'job' }) });
    const app = new Hono().post('/hook', handler);
    expect((await app.request('/hook', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(envelope) })).status).toBe(401);
    const previousAudience = process.env.GMAIL_PUBSUB_PUSH_AUDIENCE;
    const previousEmail = process.env.GMAIL_PUBSUB_PUSH_SERVICE_ACCOUNT_EMAIL;
    const previousSubscription = process.env.GMAIL_PUBSUB_SUBSCRIPTION;
    process.env.GMAIL_PUBSUB_PUSH_AUDIENCE = 'audience'; process.env.GMAIL_PUBSUB_PUSH_SERVICE_ACCOUNT_EMAIL = 'push@example.com'; process.env.GMAIL_PUBSUB_SUBSCRIPTION = envelope.subscription;
    try {
      expect((await app.request('/hook', { method: 'POST', headers: { authorization: 'Bearer signed', 'content-type': 'application/json' }, body: JSON.stringify({ ...envelope, unexpected: true }) })).status).toBe(400);
      expect((await app.request('/hook', { method: 'POST', headers: { authorization: 'Bearer signed', 'content-type': 'application/json' }, body: JSON.stringify({ ...envelope, message: { ...envelope.message, unsupported: true } }) })).status).toBe(400);
    } finally {
      if (previousAudience === undefined) delete process.env.GMAIL_PUBSUB_PUSH_AUDIENCE; else process.env.GMAIL_PUBSUB_PUSH_AUDIENCE = previousAudience;
      if (previousEmail === undefined) delete process.env.GMAIL_PUBSUB_PUSH_SERVICE_ACCOUNT_EMAIL; else process.env.GMAIL_PUBSUB_PUSH_SERVICE_ACCOUNT_EMAIL = previousEmail;
      if (previousSubscription === undefined) delete process.env.GMAIL_PUBSUB_SUBSCRIPTION; else process.env.GMAIL_PUBSUB_SUBSCRIPTION = previousSubscription;
    }
  });
});
