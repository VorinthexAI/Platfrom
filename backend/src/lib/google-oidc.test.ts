import { describe, expect, test } from 'bun:test';
import { verifyGoogleOidcToken } from './google-oidc';

describe('Google OIDC verification', () => {
  test('accepts only signed tokens for the configured Pub/Sub identity', async () => {
    const keys = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
    const publicJwk = await crypto.subtle.exportKey('jwk', keys.publicKey);
    const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
    const header = encode({ alg: 'RS256', kid: 'push-key' });
    const tokenFor = async (overrides: Record<string, unknown> = {}) => {
      const payload = encode({ iss: 'https://accounts.google.com', aud: 'https://vorinthex.com/api/v1/webhooks/gmail/pubsub', sub: 'service-account', exp: Math.floor(Date.now() / 1000) + 300, email: 'gmail-push@example.iam.gserviceaccount.com', email_verified: true, ...overrides });
      const input = `${header}.${payload}`;
      const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', keys.privateKey, new TextEncoder().encode(input));
      return `${input}.${Buffer.from(signature).toString('base64url')}`;
    };
    const loadKeys = async () => [{ ...publicJwk, kid: 'push-key', alg: 'RS256', use: 'sig' }];
    const expected = { audience: 'https://vorinthex.com/api/v1/webhooks/gmail/pubsub', email: 'gmail-push@example.iam.gserviceaccount.com' };
    expect(await verifyGoogleOidcToken(await tokenFor(), expected, loadKeys)).toEqual({ subject: 'service-account', email: expected.email });
    expect(await verifyGoogleOidcToken(await tokenFor({ aud: 'wrong' }), expected, loadKeys)).toBeNull();
    expect(await verifyGoogleOidcToken(await tokenFor({ email: 'attacker@example.com' }), expected, loadKeys)).toBeNull();
    expect(await verifyGoogleOidcToken(await tokenFor({ exp: 1 }), expected, loadKeys)).toBeNull();
  });
});
