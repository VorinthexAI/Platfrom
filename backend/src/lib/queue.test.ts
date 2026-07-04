import { describe, expect, test } from 'bun:test';
import { normalizeQueueName } from './queue';

describe('queue helpers', () => {
  test('normalizes BullMQ queue names', () => {
    expect(normalizeQueueName('scheduled:functions')).toBe('scheduled-functions');
    expect(normalizeQueueName('queue:ROLE_STORY')).toBe('queue-ROLE_STORY');
  });
});

