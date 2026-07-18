import { describe, expect, test } from 'bun:test';
import { newId } from '@/lib/ids';
import { runtimeVariableSchema } from './schema';

describe('runtime variables', () => {
  test('store scoped facts without executable behavior', () => {
    const variable = runtimeVariableSchema.parse({ key: newId(), organizationKey: newId(), scopeKey: null, agentKey: null, name: 'brand.tone', value: { voice: 'direct' } });
    expect(variable.value).toEqual({ voice: 'direct' });
    expect(Object.keys(variable)).toEqual(['key', 'organizationKey', 'scopeKey', 'agentKey', 'name', 'value']);
  });
  test('accepts the legacy root organization key', () => {
    const variable = runtimeVariableSchema.parse({ key: newId(), organizationKey: 'legacy-root-key', scopeKey: null, agentKey: null, name: 'brand.tone', value: 'direct' });
    expect(variable.organizationKey).toBe('legacy-root-key');
    expect(() => runtimeVariableSchema.parse({ ...variable, organizationKey: ' ' })).toThrow();
  });
  test('rejects unknown fields and invalid names', () => {
    expect(() => runtimeVariableSchema.parse({ key: newId(), organizationKey: newId(), scopeKey: null, agentKey: null, name: 'bad name', value: true })).toThrow();
    expect(() => runtimeVariableSchema.parse({ key: newId(), organizationKey: newId(), scopeKey: null, agentKey: null, name: 'valid', value: true, secret: 'no' })).toThrow();
  });
});
