import { describe, expect, test } from 'bun:test';
import { isPolarWebhookPath } from './payments';
import { isResendWebhookPath } from './resend';
import { rateLimitByIp, requireEnvApiKey } from './middleware';

function middlewareContext(path: string, headers: Record<string, string> = {}) {
  return {
    req: {
      path,
      header(name: string) {
        return headers[name.toLowerCase()];
      },
      url: `https://api.example.com${path}`,
    },
    header() {},
    json(payload: unknown, status = 200) {
      return new Response(JSON.stringify(payload), { status });
    },
  } as any;
}

describe('api middleware webhook exemptions', () => {
  test('recognizes Polar webhook paths with or without the api prefix', () => {
    expect(isPolarWebhookPath('/api/v1/webhooks/polar')).toBe(true);
    expect(isPolarWebhookPath('/api/v1/webhooks/polar/')).toBe(true);
    expect(isPolarWebhookPath('/webhooks/polar')).toBe(true);
    expect(isPolarWebhookPath('/webhooks/polar/')).toBe(true);
    expect(isPolarWebhookPath('/api/v1/payments/checkout')).toBe(false);
  });

  test('recognizes only the v1 Resend webhook path', () => {
    expect(isResendWebhookPath('/api/webhooks/resend')).toBe(false);
    expect(isResendWebhookPath('/api/webhooks/resend/')).toBe(false);
    expect(isResendWebhookPath('/api/v1/webhooks/resend')).toBe(true);
    expect(isResendWebhookPath('/api/v1/webhooks/resend/')).toBe(true);
    expect(isResendWebhookPath('/api/v1/payments/checkout')).toBe(false);
  });

  test('does not require the global API key for provider webhooks', async () => {
    const previousApiKey = process.env.API_KEY;
    process.env.API_KEY = 'server-key';
    let nextCalls = 0;

    try {
      for (const path of [
        '/api/v1/webhooks/polar',
        '/api/v1/webhooks/polar/',
        '/webhooks/polar',
        '/webhooks/polar/',
        '/api/v1/webhooks/resend',
        '/api/v1/webhooks/resend/',
      ]) {
        await requireEnvApiKey(middlewareContext(path), async () => {
          nextCalls += 1;
        });
      }
      expect(nextCalls).toBe(6);
    } finally {
      if (previousApiKey === undefined) delete process.env.API_KEY;
      else process.env.API_KEY = previousApiKey;
    }
  });

  test('does not rate limit provider webhooks', async () => {
    const previousRateLimitEnabled = process.env.RATE_LIMIT_ENABLED;
    process.env.RATE_LIMIT_ENABLED = 'true';

    let nextCalls = 0;

    try {
      await rateLimitByIp(middlewareContext('/api/v1/webhooks/polar'), async () => {
        nextCalls += 1;
      });
      await rateLimitByIp(middlewareContext('/api/v1/webhooks/resend'), async () => {
        nextCalls += 1;
      });

      expect(nextCalls).toBe(2);
    } finally {
      if (previousRateLimitEnabled === undefined) delete process.env.RATE_LIMIT_ENABLED;
      else process.env.RATE_LIMIT_ENABLED = previousRateLimitEnabled;
    }
  });
});
