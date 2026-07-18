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
      expect(() => toolDefinitionSchema.parse({ ...tool, actionId: 'core.ask' })).toThrow();
    }
  });
  test('uses dot notation and resolves known handlers', () => {
    for (const id of TOOL_IDS) expect(isValidToolIdFormat(id)).toBe(true);
    expect(getTool('ask.answer').name).toBe('Ask');
    expect(() => getTool('nope.missing')).toThrow(UnknownToolError);
  });

  test('registers the complete organization member tool surface', () => {
    expect(TOOL_IDS.filter((id) => id.startsWith('organization.member.'))).toEqual([
      'organization.member.list',
      'organization.member.read',
      'organization.member.add',
      'organization.member.role.update',
      'organization.member.activate',
      'organization.member.suspend',
      'organization.member.remove',
    ]);
    expect(getTool('organization.member.remove').description).toContain('immediately revoke runtime access');
  });

  test('registers the complete scope lifecycle tool surface', () => {
    expect(TOOL_IDS.filter((id) => id.startsWith('scope.') && !id.startsWith('scope.agent.') && !id.startsWith('scope.member.'))).toEqual([
      'scope.list',
      'scope.read',
      'scope.create',
      'scope.update',
      'scope.move',
      'scope.archive',
      'scope.restore',
      'scope.remove',
    ]);
    expect(getTool('scope.remove').description).toContain('owner-only confirmation');
  });

  test('registers the complete local access-management surface', () => {
    expect(TOOL_IDS.filter((id) => id.startsWith('scope.member.'))).toHaveLength(7);
    expect(TOOL_IDS.filter((id) => id.startsWith('scope.agent.'))).toHaveLength(8);
    expect(TOOL_IDS.filter((id) => id.startsWith('agent.member.'))).toHaveLength(5);
    expect(TOOL_IDS.filter((id) => id.startsWith('organization.provider.'))).toHaveLength(5);
    expect(TOOL_IDS.filter((id) => id.startsWith('access.'))).toHaveLength(6);
  });
});
