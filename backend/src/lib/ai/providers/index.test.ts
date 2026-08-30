import { describe, expect, test } from 'bun:test';
import { ACTION_DEFINITIONS } from '@/lib/ai/actions';
import { assertProviderRegistryIntegrity, getExternalModelId, getModel, MODEL_IDS, PROVIDER_REGISTRY } from './index';
import { normalizeProviderError, PRE_EXECUTION_ERROR_CODES, ProviderError, providerErrorCodeForStatus } from './errors';
import { PROVIDER_SLUGS, chatInputSchema } from './types';

describe('provider registry', () => {
  test('contains a factory for every PROVIDER_SLUGS entry and nothing else', () => {
    expect(Object.keys(PROVIDER_REGISTRY).sort()).toEqual([...PROVIDER_SLUGS].sort());
  });

  test('every factory id matches its registry key', () => {
    for (const [key, provider] of Object.entries(PROVIDER_REGISTRY)) {
      expect(provider.id).toBe(key as (typeof PROVIDER_SLUGS)[number]);
      expect(provider.factory.id).toBe(key as (typeof PROVIDER_SLUGS)[number]);
    }
  });

  test('every factory rejects an empty config', () => {
    for (const provider of Object.values(PROVIDER_REGISTRY)) {
      expect(() => provider.factory.create({})).toThrow();
    }
  });

  test('adapters built from create() carry the right id', () => {
    const adapter = PROVIDER_REGISTRY.openrouter.factory.create({ apiKey: 'test-key' });
    expect(adapter.id).toBe('openrouter');
    expect(adapter.name).toBe('OpenRouter');
  });

  test('OpenRouter requires an API key and creates configured instances', () => {
    const factory = PROVIDER_REGISTRY.openrouter.factory;
    expect(() => factory.create({})).toThrow();
    expect(factory.create({ apiKey: 'openrouter-key' }).id).toBe('openrouter');
  });

  test('registers unique models and resolves every action binding to a non-empty external id', () => {
    expect(() => assertProviderRegistryIntegrity()).not.toThrow();
    expect(new Set(MODEL_IDS).size).toBe(MODEL_IDS.length);
    for (const action of ACTION_DEFINITIONS) {
      for (const binding of action.models) {
        expect(getModel(binding.model)).toBeDefined();
        expect(PROVIDER_REGISTRY[binding.provider]).toBeDefined();
        expect(getExternalModelId(binding.model, binding.provider)?.trim()).not.toBe('');
      }
    }
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
    const normalized = normalizeProviderError('openrouter', err);
    expect(normalized).toBeInstanceOf(ProviderError);
    expect(normalized.code).toBe('rate_limited');
    expect(normalized.retryable).toBe(true);
    expect(normalized.providerId).toBe('openrouter');
  });

  test('normalizes abort and timeout errors', () => {
    const abort = new DOMException('The operation was aborted.', 'AbortError');
    expect(normalizeProviderError('openrouter', abort).code).toBe('aborted');
    expect(normalizeProviderError('openrouter', abort).retryable).toBe(false);

    const timeout = Object.assign(new Error('timed out'), { name: 'TimeoutError' });
    expect(normalizeProviderError('openrouter', timeout).code).toBe('timeout');
  });

  test('passes existing ProviderErrors through untouched', () => {
    const original = new ProviderError('openrouter', 'invalid_input', 'bad input');
    expect(normalizeProviderError('openrouter', original)).toBe(original);
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
    expect(chatInputSchema.parse({ messages: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }] }).messages).toHaveLength(1);
    expect(() => chatInputSchema.parse({ messages: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }], organizationProviderKey: 'retired' })).toThrow();
    expect(() => chatInputSchema.parse({ messages: [] })).toThrow();
  });
});
