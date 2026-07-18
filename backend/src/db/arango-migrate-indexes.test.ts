import { describe, expect, test } from 'bun:test';
import { isLegacyIndex } from './arango-migrate-indexes';

describe('Arango migration indexes', () => {
  test('drops the obsolete one-agent-per-database scope assignment index', () => {
    expect(isLegacyIndex('scopeAgents', ['agentKey'])).toBe(true);
    expect(isLegacyIndex('scopeAgents', ['scopeKey', 'agentKey'])).toBe(false);
    expect(isLegacyIndex('scopeAgents', ['agentKey', 'status'])).toBe(false);
  });
});
