import { describe, expect, test } from 'bun:test';
import { newId } from '@/lib/ids';
import type { DomainToolContext } from '@/lib/ai/tools/domain-execute';
import type { runContentTool } from '@/lib/ai/tools/content-runtime';
import { AssistantCapabilityRegistry } from './capabilities';
import { runPersonalAssistant } from './runtime';

const organizationKey = newId();
const scopeKey = newId();
const documentKey = newId();
const domain = {
  organizationKey,
  runtimeScopeKey: scopeKey,
  principal: { kind: 'member', user: { key: newId() }, userOrganization: { key: newId(), organizationId: organizationKey, status: 'active' } },
} as unknown as DomainToolContext;

const input = { surface: 'knowledge-workspace' as const, message: 'Help me', currentNote: { title: 'Notes', content: 'Existing text' } };
const response = (output: unknown) => ({ output });

describe('personal assistant runtime', () => {
  test('answers directly through the explicitly pinned Nova Lite route', async () => {
    let request: unknown;
    let chatInput: any;
    const result = await runPersonalAssistant(input, domain, {
      execute: async (nextRequest, nextInput) => {
        request = nextRequest;
        chatInput = nextInput;
        return response({ text: 'Here is the answer.', toolCalls: [], stopReason: 'end_turn' });
      },
    });

    expect(request).toEqual({ mode: 'model', organizationKey, actionSlug: 'orchestrator-chat', modelSlug: 'amazon.nova-lite' });
    expect(chatInput.tools.map(({ name }: { name: string }) => name)).toEqual(['search_knowledge', 'write_note']);
    expect(result).toEqual({ type: 'answer', message: 'Here is the answer.', sources: [] });
  });

  test('searches authorized knowledge before answering and returns sources', async () => {
    let modelCalls = 0;
    let searchInput: unknown;
    const result = await runPersonalAssistant(input, domain, {
      execute: async (_request, nextInput) => {
        modelCalls += 1;
        if (modelCalls === 1) return response({ text: '', toolCalls: [{ id: 'search-1', name: 'search_knowledge', arguments: { query: 'roadmap' } }], stopReason: 'tool_use' });
        expect(nextInput.messages.at(-1)).toMatchObject({ role: 'tool', content: [{ type: 'tool-result', toolCallId: 'search-1' }] });
        return response({ text: 'The launch is in October.', toolCalls: [], stopReason: 'end_turn' });
      },
      executeContent: (async (_name: Parameters<typeof runContentTool>[0], nextInput: Parameters<typeof runContentTool>[1]) => {
        searchInput = nextInput;
        return { query: 'roadmap', results: [{ documentKey, scopeKey, name: 'Roadmap', score: 0.9, snippet: 'Launch in October.' }], totalCandidates: 1 };
      }) as any,
    });

    expect(searchInput).toEqual({ scopeKey, query: 'roadmap', topK: 8, include: ['snippet'] });
    expect(modelCalls).toBe(2);
    expect(result).toEqual({ type: 'answer', message: 'The launch is in October.', sources: [{ documentKey, name: 'Roadmap' }] });
  });

  test('returns a structured full-note replacement from the write capability', async () => {
    const result = await runPersonalAssistant(input, domain, {
      execute: async () => response({ text: '', toolCalls: [{ id: 'write-1', name: 'write_note', arguments: { content: 'Rewritten text', message: 'Rewrote the note.' } }], stopReason: 'tool_use' }),
    });
    expect(result).toEqual({ type: 'note', content: 'Rewritten text', message: 'Rewrote the note.', sources: [] });
  });

  test('rejects capabilities outside the server-selected surface allowlist', async () => {
    await expect(runPersonalAssistant(input, domain, {
      execute: async () => response({ text: '', toolCalls: [{ id: 'bad-1', name: 'delete_everything', arguments: {} }], stopReason: 'tool_use' }),
    })).rejects.toThrow('unavailable capability');
  });

  test('rejects truncated tool calls and bounds repeated searches', async () => {
    await expect(runPersonalAssistant(input, domain, {
      execute: async () => response({ text: '', toolCalls: [{ id: 'write-1', name: 'write_note', arguments: { content: 'Partial', message: 'Changed it.' } }], stopReason: 'max_tokens' }),
    })).rejects.toThrow('ended unexpectedly');

    let calls = 0;
    await expect(runPersonalAssistant(input, domain, {
      execute: async () => {
        calls += 1;
        return response({ text: '', toolCalls: [{ id: `search-${calls}`, name: 'search_knowledge', arguments: { query: 'roadmap' } }], stopReason: 'tool_use' });
      },
      executeContent: (async () => ({ query: 'roadmap', results: [], totalCandidates: 0 })) as any,
    })).rejects.toThrow('iteration limit');
    expect(calls).toBe(4);
  });

  test('supports independently configured surface registries', () => {
    const registry = new AssistantCapabilityRegistry().register({
      definition: { name: 'future_capability', description: 'Future behavior.', inputSchema: { type: 'object' } },
      async execute() { return { kind: 'continue', result: {} }; },
    }).registerSurface('knowledge-workspace', ['future_capability']);
    expect(registry.resolve('knowledge-workspace').map(({ definition }) => definition.name)).toEqual(['future_capability']);
  });
});
