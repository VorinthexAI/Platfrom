import { describe, expect, test } from 'bun:test';
import { verifyPolarWebhookSignature } from './polar';

async function sign(secret: string | Buffer, webhookId: string, timestamp: string, rawBody: string) {
  const key = await crypto.subtle.importKey(
    'raw',
    typeof secret === 'string'
      ? Buffer.from(secret.replace(/^whsec_/, ''), 'base64')
      : Buffer.from(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${webhookId}.${timestamp}.${rawBody}`));
  return `v1,${Buffer.from(signature).toString('base64')}`;
}

async function signRawSecret(secret: string, webhookId: string, timestamp: string, rawBody: string) {
  return sign(Buffer.from(secret, 'utf8'), webhookId, timestamp, rawBody);
}

describe('Polar webhook verification', () => {
  test('accepts a valid Standard Webhooks signature', async () => {
    const secret = `whsec_${Buffer.from('test-secret-material').toString('base64')}`;
    const webhookId = 'evt_test';
    const webhookTimestamp = String(Math.floor(Date.now() / 1000));
    const rawBody = JSON.stringify({ type: 'order.paid', data: { id: 'ord_test' } });

    expect(await verifyPolarWebhookSignature({
      rawBody,
      webhookId,
      webhookTimestamp,
      webhookSignature: await sign(secret, webhookId, webhookTimestamp, rawBody),
      secret,
    })).toBe(true);
  });

  test('accepts a valid Polar SDK signature made with a whsec-looking secret', async () => {
    const secret = 'whsec_cggnPolarStyleSecretValueThatIsNotBase64KeyMaterial';
    const webhookId = 'evt_test';
    const webhookTimestamp = String(Math.floor(Date.now() / 1000));
    const rawBody = JSON.stringify({ type: 'product.updated', data: { id: 'prod_test' } });

    expect(await verifyPolarWebhookSignature({
      rawBody,
      webhookId,
      webhookTimestamp,
      webhookSignature: await signRawSecret(secret, webhookId, webhookTimestamp, rawBody),
      secret,
    })).toBe(true);
  });

  test('accepts a valid signature made with a plain Polar secret', async () => {
    const secret = '6t3c8ce2247c493a3ade20uea4484d64';
    const webhookId = 'evt_test';
    const webhookTimestamp = String(Math.floor(Date.now() / 1000));
    const rawBody = JSON.stringify({ type: 'checkout.created', data: { id: 'chk_test' } });

    expect(await verifyPolarWebhookSignature({
      rawBody,
      webhookId,
      webhookTimestamp,
      webhookSignature: await signRawSecret(secret, webhookId, webhookTimestamp, rawBody),
      secret,
    })).toBe(true);
  });

  test('rejects unsigned webhooks when no secret is configured', async () => {
    const previousSecret = process.env.POLAR_WEBHOOK_SECRET;
    const previousSkip = process.env.POLAR_SKIP_WEBHOOK_VERIFICATION;
    delete process.env.POLAR_WEBHOOK_SECRET;
    delete process.env.POLAR_SKIP_WEBHOOK_VERIFICATION;
    try {
      expect(await verifyPolarWebhookSignature({
        rawBody: '{}',
        webhookId: 'evt_test',
        webhookTimestamp: String(Math.floor(Date.now() / 1000)),
        webhookSignature: 'v1,forged',
      })).toBe(false);
    } finally {
      if (previousSecret !== undefined) process.env.POLAR_WEBHOOK_SECRET = previousSecret;
      if (previousSkip !== undefined) process.env.POLAR_SKIP_WEBHOOK_VERIFICATION = previousSkip;
    }
  });

  test('rejects stale timestamps', async () => {
    const secret = `whsec_${Buffer.from('test-secret-material').toString('base64')}`;
    const webhookId = 'evt_test';
    const webhookTimestamp = String(Math.floor(Date.now() / 1000) - 3600);
    const rawBody = JSON.stringify({ type: 'order.paid', data: { id: 'ord_test' } });

    expect(await verifyPolarWebhookSignature({
      rawBody,
      webhookId,
      webhookTimestamp,
      webhookSignature: await sign(secret, webhookId, webhookTimestamp, rawBody),
      secret,
    })).toBe(false);
  });

  test('rejects tampered payloads', async () => {
    const secret = `whsec_${Buffer.from('test-secret-material').toString('base64')}`;
    const webhookId = 'evt_test';
    const webhookTimestamp = String(Math.floor(Date.now() / 1000));
    const rawBody = JSON.stringify({ type: 'order.paid', data: { id: 'ord_test' } });

    expect(await verifyPolarWebhookSignature({
      rawBody: JSON.stringify({ type: 'order.paid', data: { id: 'ord_tampered' } }),
      webhookId,
      webhookTimestamp,
      webhookSignature: await sign(secret, webhookId, webhookTimestamp, rawBody),
      secret,
    })).toBe(false);
  });
});
