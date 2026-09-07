import { describe, expect, test } from 'bun:test';
import { authTransportSchemas } from './routes';

const code = '0123456789ab';
const idToken = 'x'.repeat(100);

describe('user acquisition auth transport schemas', () => {
  test('accept referral_code optionally on every verified user acquisition path', () => {
    const cases = [
      [authTransportSchemas.login, { email: 'user@example.com' }],
      [authTransportSchemas.oauthStart, { provider: 'google', redirect_uri: 'https://app.example.com/callback' }],
      [authTransportSchemas.mobileOAuthStart, { redirect_uri: 'vorinthexcore://auth/oauth-complete' }],
      [authTransportSchemas.mobileGoogle, { id_token: idToken }],
      [authTransportSchemas.mobileApple, { id_token: idToken, nonce: crypto.randomUUID() }],
    ] as const;
    for (const [schema, input] of cases) {
      expect(schema.parse(input)).toEqual(input);
      expect(schema.parse({ ...input, referral_code: ` ${code} ` })).toMatchObject({ referral_code: code });
      expect(() => schema.parse({ ...input, referral_code: '' })).toThrow();
      expect(() => schema.parse({ ...input, referral_code: 'not-a-referral-code' })).toThrow();
      expect(() => schema.parse({ ...input, unexpected: true })).toThrow('Unrecognized key');
    }
  });

  test('keeps unverified signup strict and does not imply referral qualification', () => {
    expect(authTransportSchemas.signup.parse({ email: 'user@example.com' })).toEqual({ email: 'user@example.com' });
    expect(() => authTransportSchemas.signup.parse({ email: 'user@example.com', referral_code: code })).toThrow('Unrecognized key');
  });
});
