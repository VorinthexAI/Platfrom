import { describe, expect, test } from 'bun:test';
import { ask } from './ask';

describe('ask', () => {
  test('echoes the message back through the placeholder reply', async () => {
    const reply = await ask({ skill: 'You are a helpful orchestrator.', message: 'status update?' });
    expect(reply).toContain('status update?');
  });

  test('does not require a non-empty skill', async () => {
    const reply = await ask({ skill: '', message: 'hello' });
    expect(reply).toContain('hello');
  });
});
