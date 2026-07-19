import { describe, expect, test } from 'bun:test';
import { newId } from '@/lib/ids';
import { toolSchema, toolsEmbedKeys } from './tools.node';
import { toolActionSchema, toolActionSeedSchema } from './tool-actions.node';

describe('tool persistence schemas', () => {
  test('stores reusable tools independently from their actions', () => {
    const tool = toolSchema.parse({
      key: newId(),
      slug: 'ask.answer',
      name: 'Ask',
      description: 'Answer the user.',
    });

    expect(tool.scopeKey).toBeNull();
    expect(tool.enabled).toBe(true);
    expect(tool.embedding).toEqual([]);
    expect(tool).not.toHaveProperty('actionId');
    expect(toolsEmbedKeys.options).toEqual(['name', 'description']);
  });

  test('links tools to actions through toolActions', () => {
    const relation = toolActionSchema.parse({
      key: newId(),
      toolKey: newId(),
      actionKey: 'cm9action01vorinthexseed',
    });

    expect(relation.priority).toBe(100);
    expect(relation.enabled).toBe(true);
    expect(relation).not.toHaveProperty('embedding');
    expect(toolActionSeedSchema.parse({
      key: newId(),
      toolSlug: 'ask.answer',
      actionSlug: 'core.chat',
      priority: 100,
      enabled: true,
    }).actionSlug).toBe('core.chat');
  });
});
