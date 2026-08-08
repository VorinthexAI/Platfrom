import { describe, expect, test } from 'bun:test';
import { dedupeMentionCandidates } from './mention-candidates';

describe('Communication mention candidates', () => {
  test('deduplicates normalized labels within each mention lane', () => {
    const candidates = [
      { participantKey: 'everyone', type: 'everyone' as const, key: 'everyone', name: 'everyone', mentionCount: 0 },
      { participantKey: 'user-a', type: 'user' as const, key: 'user-a', name: 'Oscar', mentionCount: 3 },
      { participantKey: 'user-b', type: 'user' as const, key: 'user-b', name: ' oscar ', mentionCount: 1 },
      { participantKey: 'agent-a', type: 'orchestrator' as const, key: 'agent-a', name: 'Atlas', mentionCount: 0 },
      { participantKey: 'agent-b', type: 'orchestrator' as const, key: 'agent-b', name: 'ATLAS', mentionCount: 0 },
      { participantKey: 'user-everyone', type: 'user' as const, key: 'user-everyone', name: 'Everyone', mentionCount: 0 },
    ];
    expect(dedupeMentionCandidates(candidates).map(({ participantKey }) => participantKey)).toEqual(['everyone', 'user-a', 'agent-a']);
  });
});
