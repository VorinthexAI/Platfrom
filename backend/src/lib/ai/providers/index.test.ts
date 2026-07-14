import { describe, expect, test } from 'bun:test';
import { createProviderAdaptersFromEnv, PROVIDER_FACTORIES } from './index';
import { normalizeProviderError, PRE_EXECUTION_ERROR_CODES, ProviderError, providerErrorCodeForStatus } from './errors';
import { PROVIDER_IDS, chatInputSchema } from './types';

describe('provider registry', () => {
  test('contains a factory for every PROVIDER_IDS entry and nothing else', () => {
    expect(Object.keys(PROVIDER_FACTORIES).sort()).toEqual([...PROVIDER_IDS].sort());
  });

  test('every factory id matches its registry key', () => {
    for (const [key, factory] of Object.entries(PROVIDER_FACTORIES)) {
      expect(factory.id).toBe(key as (typeof PROVIDER_IDS)[number]);
    }
  });

  test('every factory rejects an empty config', () => {
    for (const factory of Object.values(PROVIDER_FACTORIES)) {
      expect(() => factory.create({})).toThrow();
    }
  });

  test('adapters built from create() carry the right id', () => {
    const adapter = PROVIDER_FACTORIES.openai.create({ apiKey: 'test-key' });
    expect(adapter.id).toBe('openai');
    expect(adapter.name).toBe('OpenAI');
  });

  test('google-vertex requires apiKey or accessToken + projectId', () => {
    const factory = PROVIDER_FACTORIES['google-vertex'];
    expect(() => factory.create({ location: 'us-central1' })).toThrow();
    expect(() => factory.create({ accessToken: 'tok' })).toThrow();
    expect(factory.create({ apiKey: 'k' }).id).toBe('google-vertex');
    expect(factory.create({ accessToken: 'tok', projectId: 'proj' }).id).toBe('google-vertex');
  });

  test('fromEnv returns null when configuration is missing', () => {
    for (const factory of Object.values(PROVIDER_FACTORIES)) {
      expect(factory.fromEnv({})).toBeNull();
    }
  });

  test('createProviderAdaptersFromEnv only builds configured providers', () => {
    const adapters = createProviderAdaptersFromEnv({
      OPENAI_API_KEY: 'a',
      ANTHROPIC_API_KEY: 'b',
      GROK_API_KEY: 'c',
    });
    expect(Object.keys(adapters).sort()).toEqual(['anthropic', 'openai', 'xai']);
    expect(adapters.openai?.id).toBe('openai');
  });

  test('aws-bedrock requires the explicit AWS_BEDROCK_REGION opt-in', () => {
    const withoutRegion = createProviderAdaptersFromEnv({
      AWS_ACCESS_KEY_ID: 'k',
      AWS_SECRET_ACCESS_KEY: 's',
    });
    expect(withoutRegion['aws-bedrock']).toBeUndefined();

    const withRegion = createProviderAdaptersFromEnv({
      AWS_BEDROCK_REGION: 'us-east-1',
      AWS_ACCESS_KEY_ID: 'k',
      AWS_SECRET_ACCESS_KEY: 's',
    });
    expect(withRegion['aws-bedrock']?.id).toBe('aws-bedrock');
  });
});

describe('provider error normalization', () => {
  test('maps HTTP statuses onto stable codes', () => {
    expect(providerErrorCodeForStatus(401)).toBe('authentication_failed');
    expect(providerErrorCodeForStatus(403)).toBe('authentication_failed');
    expect(providerErrorCodeForStatus(408)).toBe('timeout');
    expect(providerErrorCodeForStatus(429)).toBe('rate_limited');
    expect(providerErrorCodeForStatus(500)).toBe('provider_unavailable');
    expect(providerErrorCodeForStatus(503)).toBe('provider_unavailable');
    expect(providerErrorCodeForStatus(400)).toBe('invalid_input');
    expect(providerErrorCodeForStatus(418)).toBe('unknown');
  });

  test('normalizes SDK errors carrying a status', () => {
    const err = Object.assign(new Error('Too Many Requests'), { status: 429 });
    const normalized = normalizeProviderError('openai', err);
    expect(normalized).toBeInstanceOf(ProviderError);
    expect(normalized.code).toBe('rate_limited');
    expect(normalized.retryable).toBe(true);
    expect(normalized.providerId).toBe('openai');
  });

  test('normalizes abort and timeout errors', () => {
    const abort = new DOMException('The operation was aborted.', 'AbortError');
    expect(normalizeProviderError('anthropic', abort).code).toBe('aborted');
    expect(normalizeProviderError('anthropic', abort).retryable).toBe(false);

    const timeout = Object.assign(new Error('timed out'), { name: 'TimeoutError' });
    expect(normalizeProviderError('anthropic', timeout).code).toBe('timeout');
  });

  test('passes existing ProviderErrors through untouched', () => {
    const original = new ProviderError('xai', 'invalid_input', 'bad input');
    expect(normalizeProviderError('xai', original)).toBe(original);
    expect(original.retryable).toBe(false);
  });

  test('pre-execution codes never include ambiguous post-execution failures', () => {
    expect(PRE_EXECUTION_ERROR_CODES.has('rate_limited')).toBe(true);
    expect(PRE_EXECUTION_ERROR_CODES.has('authentication_failed')).toBe(true);
    expect(PRE_EXECUTION_ERROR_CODES.has('timeout')).toBe(false);
    expect(PRE_EXECUTION_ERROR_CODES.has('response_invalid')).toBe(false);
  });
});

describe('normalized chat input', () => {
  test('accepts a minimal chat request and rejects unknown fields', () => {
    expect(chatInputSchema.parse({ messages: [{ role: 'user', content: 'hi' }] }).messages).toHaveLength(1);
    expect(() => chatInputSchema.parse({ messages: [{ role: 'user', content: 'hi' }], extra: true })).toThrow();
    expect(() => chatInputSchema.parse({ messages: [] })).toThrow();
  });
});
