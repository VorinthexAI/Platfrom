import { describe, expect, test } from 'bun:test';
import { ACTION_SLUGS } from '@/lib/ai/actions';
import { newId } from '@/lib/ids';
import { actionSchema, actionSlugSchema } from './actions.node';

describe('action node schema', () => {
  test('uses the AI action registry as its slug source of truth', () => {
    expect(actionSlugSchema.options).toEqual([...ACTION_SLUGS]);
  });

  test('parses a persisted action and applies node defaults', () => {
    const action = actionSchema.parse({
      key: newId(),
      slug: 'core.ask',
      name: 'Ask',
      description: 'Answer a conversational request.',
      objective: 'Provide a useful response to the user.',
      inputDescription: 'A message history and request context.',
      outputDescription: 'A text response.',
      handlerKey: 'core.ask',
    });

    expect(action.enabled).toBe(true);
    expect(action.embedding).toEqual([]);
  });

  test('rejects unknown slugs and mismatched handlers', () => {
    const base = {
      key: 'action_unknown',
      slug: 'core.unknown',
      name: 'Unknown',
      description: 'Unknown action.',
      objective: 'Unknown objective.',
      inputDescription: 'Unknown input.',
      outputDescription: 'Unknown output.',
      handlerKey: 'core.unknown',
    };

    expect(() => actionSchema.parse(base)).toThrow();
    expect(() => actionSchema.parse({
      ...base,
      slug: 'core.ask',
      handlerKey: 'core.reason',
    })).toThrow('handlerKey must match slug');
  });
});
