import { describe, expect, test } from 'bun:test';
import { ACTION_REGISTRY } from '@/lib/ai/actions';
import { assertToolRegistryIntegrity, getTool, listTools, TOOL_REGISTRY, UnknownToolError } from './index';
import { isValidToolIdFormat, TOOL_IDS, toolDefinitionSchema } from './types';

describe('tool registry', () => {
  test('passes the full integrity check', () => {
    expect(() => assertToolRegistryIntegrity()).not.toThrow();
  });

  test('contains every TOOL_IDS entry and nothing else', () => {
    expect(Object.keys(TOOL_REGISTRY).sort()).toEqual([...TOOL_IDS].sort());
  });

  test('every tool references a registered action — and actions only', () => {
    for (const tool of listTools()) {
      expect(tool.actionId in ACTION_REGISTRY).toBe(true);
      // The strict schema is the structural guarantee: any provider or
      // endpoint field on a tool definition is a validation error.
      expect(() => toolDefinitionSchema.parse({ ...tool, providerId: 'openai' })).toThrow();
      expect(() => toolDefinitionSchema.parse({ ...tool, endpoint: 'https://api.example.com' })).toThrow();
    }
  });

  test('tool ids follow dot notation', () => {
    for (const id of TOOL_IDS) expect(isValidToolIdFormat(id)).toBe(true);
    expect(isValidToolIdFormat('NotATool')).toBe(false);
  });

  test('routing preferences are optional hints with validated shapes', () => {
    expect(TOOL_REGISTRY['reason.solve'].routing?.strategy).toBe('quality');
    expect(() =>
      toolDefinitionSchema.parse({ ...TOOL_REGISTRY['chat.reply'], routing: { providerId: 'openai' } }),
    ).toThrow();
  });

  test('getTool resolves known tools and rejects unknown ids', () => {
    expect(getTool('chat.reply').actionId).toBe('core.chat');
    expect(() => getTool('nope.missing')).toThrow(UnknownToolError);
  });
});
