import { describe, expect, test } from 'bun:test';
import { ACTION_SLUGS } from '@/lib/ai/actions';
import { actionSchema, actionSlugSchema } from './actions.node';

const timestamp = '2026-07-14T12:00:00.000Z';

describe('action node schema', () => {
  test('uses the AI action registry as its slug source of truth', () => {
    expect(actionSlugSchema.options).toEqual([...ACTION_SLUGS]);
  });

  test('parses a persisted action and applies node defaults', () => {
    const action = actionSchema.parse({
      key: 'action_core_ask',
      slug: 'core.ask',
      name: 'Ask',
      description: 'Answer a conversational request.',
      objective: 'Provide a useful response to the user.',
      inputDescription: 'A message history and request context.',
      outputDescription: 'A text response.',
      handlerKey: 'core.ask',
      createdAt: timestamp,
      updatedAt: timestamp,
    });

    expect(action.enabled).toBe(true);
    expect(action.embedding).toEqual([]);
  });

  test('rejects unknown slugs and malformed timestamps', () => {
    const base = {
      key: 'action_unknown',
      slug: 'core.unknown',
      name: 'Unknown',
      description: 'Unknown action.',
      objective: 'Unknown objective.',
      inputDescription: 'Unknown input.',
      outputDescription: 'Unknown output.',
      handlerKey: 'core.unknown',
      createdAt: timestamp,
      updatedAt: 'not-a-timestamp',
    };

    expect(() => actionSchema.parse(base)).toThrow();
  });
});
