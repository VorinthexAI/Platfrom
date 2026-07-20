import { describe, expect, test } from 'bun:test';
import { assertToolRegistryIntegrity, getTool, listTools, TOOL_REGISTRY, UnknownToolError } from './index';
import { isValidToolIdFormat, TOOL_IDS, toolDefinitionSchema } from './types';
describe('tool handler registry', () => {
  test('is complete and contains no duplicated relation data', () => {
    expect(() => assertToolRegistryIntegrity()).not.toThrow();
    expect(Object.keys(TOOL_REGISTRY).sort()).toEqual([...TOOL_IDS].sort());
    for (const tool of listTools()) {
      expect(tool).not.toHaveProperty('actionId');
      expect(tool).not.toHaveProperty('modelId');
      expect(tool).not.toHaveProperty('providerId');
      expect(() => toolDefinitionSchema.parse({ ...tool, actionId: 'core.chat' })).toThrow();
    }
  });
  test('has no active tools', () => {
    expect(TOOL_IDS).toEqual([]);
    expect(listTools()).toEqual([]);
    expect(() => getTool('anything')).toThrow(UnknownToolError);
    expect(isValidToolIdFormat('anything')).toBe(false);
  });
});
