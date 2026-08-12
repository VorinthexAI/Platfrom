import { describe, expect, test } from 'bun:test';
import { Hono } from 'hono';
import { createGmailWebhookHandler, isGmailWebhookPath } from './email-webhook';

const payload = { emailAddress: 'Person@Example.com', historyId: '1234' };
const envelope = { message: { data: Buffer.from(JSON.stringify(payload)).toString('base64'), messageId: 'message-1', publishTime: '2026-08-11T12:00:00.000Z' }, subscription: 'projects/project/subscriptions/gmail' };

describe('Gmail Pub/Sub webhook', () => {
  test('recognizes only the exact webhook path', () => {
    expect(isGmailWebhookPath('/api/v1/webhooks/gmail/pubsub')).toBe(true);
    expect(isGmailWebhookPath('/api/v1/webhooks/gmail/pubsub/')).toBe(true);
    expect(isGmailWebhookPath('/api/webhooks/gmail/pubsub')).toBe(false);
  });

  test('verifies identity and durably enqueues a strict notification', async () => {
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
    } finally {
      if (previousAudience === undefined) delete process.env.GMAIL_PUBSUB_PUSH_AUDIENCE; else process.env.GMAIL_PUBSUB_PUSH_AUDIENCE = previousAudience;
      if (previousEmail === undefined) delete process.env.GMAIL_PUBSUB_PUSH_SERVICE_ACCOUNT_EMAIL; else process.env.GMAIL_PUBSUB_PUSH_SERVICE_ACCOUNT_EMAIL = previousEmail;
      if (previousSubscription === undefined) delete process.env.GMAIL_PUBSUB_SUBSCRIPTION; else process.env.GMAIL_PUBSUB_SUBSCRIPTION = previousSubscription;
    }
  });
});
