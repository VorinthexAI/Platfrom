import { describe, expect, test } from 'bun:test';
import { CHORUS_TOOL_SLUGS, chorusToolInputSchemas, chorusToolJsonSchemas } from './tools';

describe('Chorus V2 tool schemas', () => {
  test('registers the complete explicit Chorus tool surface', () => {
    expect(CHORUS_TOOL_SLUGS).toHaveLength(99);
    expect(CHORUS_TOOL_SLUGS).toContain('channel.participant.add');
    expect(CHORUS_TOOL_SLUGS).toContain('channel.link.create');
    expect(CHORUS_TOOL_SLUGS).toContain('message.attachment.create');
    expect(CHORUS_TOOL_SLUGS).toContain('poll.option.create');
    expect(CHORUS_TOOL_SLUGS).toContain('poll.vote.cast');
    expect(CHORUS_TOOL_SLUGS.filter((slug) => slug.endsWith('.search'))).toHaveLength(4);
    expect(CHORUS_TOOL_SLUGS).not.toContain('channel.search');
    expect(CHORUS_TOOL_SLUGS).not.toContain('channel.lifecycle');
    expect(chorusToolJsonSchemas['channel.create']).toMatchObject({ type: 'object', additionalProperties: false, required: ['channels'] });
  });

  test('uses strict batch, read, and separate lifecycle inputs', () => {
    expect(() => chorusToolInputSchemas['channel.create'].parse({ channels: [], extra: true })).toThrow();
    expect(() => chorusToolInputSchemas['message.find'].parse({ messages: ['message-1'], unexpected: true })).toThrow();
    expect(() => chorusToolInputSchemas['poll.delete'].parse({ polls: ['poll-1'], operation: 'delete' })).toThrow();
    expect(chorusToolInputSchemas['poll.delete'].parse({ polls: ['poll-1'], idempotencyKey: 'request-1' })).toMatchObject({ atomic: false });
    expect(() => chorusToolInputSchemas['channel.participant.add'].parse({ participants: [{ channelKey: 'channel-1', userKey: 'user-1', orchestratorKey: 'agent-1', role: 'member' }] })).toThrow();
  });

  test('requires a scope or organization semantic search source and applies filters', () => {
    expect(() => chorusToolInputSchemas['scope.message.search'].parse({ query: 'launch notes' })).toThrow();
    expect(chorusToolInputSchemas['scope.message.search'].parse({ query: 'launch notes', scopeKeys: ['scope-1'], channelKeys: ['channel-1'] })).toMatchObject({ limit: 20 });
    expect(() => chorusToolInputSchemas['poll.create'].parse({ polls: [{ channelKey: 'channel-1', threadKey: 'thread-1', createdByParticipantKey: 'participant-1', question: 'Ship?', multipleChoice: false, options: [{ text: 'Yes' }] }] })).toThrow();
  });
});
