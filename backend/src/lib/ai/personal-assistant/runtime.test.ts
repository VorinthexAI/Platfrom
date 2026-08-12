import { describe, expect, test } from 'bun:test';
import { newId } from '@/lib/ids';
import type { DomainToolContext } from '@/lib/ai/tools/domain-execute';
import type { runContentTool } from '@/lib/ai/tools/content-runtime';
import type { imageSearchTool } from '@/lib/ai/tools/image-search';
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

  test('exposes only image search on the media workspace', async () => {
    let chatInput: any;
    const result = await runPersonalAssistant({ ...input, surface: 'media-workspace' }, domain, {
      execute: async (_request, nextInput) => {
        chatInput = nextInput;
        return response({ text: 'I can search your Gallery.', toolCalls: [], stopReason: 'end_turn' });
      },
    });

    expect(chatInput.tools.map(({ name }: { name: string }) => name)).toEqual(['search_images']);
    expect(chatInput.systemPrompt).toContain('Call search_images whenever');
    expect(chatInput.messages[0].content[0].text).toContain('"workspace":"Gallery"');
    expect(result).toEqual({ type: 'answer', message: 'I can search your Gallery.', sources: [] });
  });

  test('answers in Compass with only authorized knowledge search available', async () => {
    let chatInput: any;
    const result = await runPersonalAssistant({ ...input, surface: 'travel-workspace' }, domain, {
      execute: async (_request, nextInput) => {
        chatInput = nextInput;
        return response({ text: 'Lisbon fits a relaxed long weekend.', toolCalls: [], stopReason: 'end_turn' });
      },
    });

    expect(chatInput.tools.map(({ name }: { name: string }) => name)).toEqual(['search_knowledge']);
    expect(chatInput.systemPrompt).toContain('operating inside Compass');
    expect(chatInput.messages[0].content[0].text).toContain('"workspace":"Compass"');
    expect(result).toEqual({ type: 'answer', message: 'Lisbon fits a relaxed long weekend.', sources: [] });
  });

  test('infers image search, executes it, and answers from the tool result', async () => {
    let modelCalls = 0;
    let searchInput: unknown;
    const result = await runPersonalAssistant({ ...input, surface: 'media-workspace', message: 'Show me photos of the red dog in snow' }, domain, {
      execute: async (_request, nextInput) => {
        modelCalls += 1;
        if (modelCalls === 1) return response({ text: '', toolCalls: [{ id: 'image-search-1', name: 'search_images', arguments: { query: 'red dog in snow' } }], stopReason: 'tool_use' });
        expect(nextInput.messages.at(-1)).toMatchObject({ role: 'tool', content: [{ type: 'tool-result', toolCallId: 'image-search-1' }] });
        return response({ text: 'I found one matching image of a red dog in snow.', toolCalls: [], stopReason: 'end_turn' });
      },
      executeImageSearch: (async (nextInput: unknown) => {
        searchInput = nextInput;
        return { query: 'red dog in snow', images: [{ key: newId(), filename: 'dog.jpg', caption: 'A red dog standing in snow.', mimeType: 'image/jpeg', sizeBytes: 100, width: 100, height: 100, isFavorite: false, createdAt: '2026-08-11T12:00:00.000Z', updatedAt: '2026-08-11T12:00:00.000Z', score: 0.94 }] };
      }) as unknown as typeof imageSearchTool.execute,
    });

    expect(searchInput).toEqual({ query: 'red dog in snow', limit: 50 });
    expect(modelCalls).toBe(2);
    expect(result).toEqual({ type: 'answer', message: 'I found one matching image of a red dog in snow.', sources: [] });
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

  test('creates and writes a book through sequential scoped capabilities', async () => {
    const bookKey = newId();
    const brief = { topic: 'Decision making', goal: 'Make clearer decisions', audience: 'Curious leaders', tone: 'Warm and rigorous', length: 'short', language: 'English' } as const;
    const contentCalls: Array<{ name: string; input: any }> = [];
    let modelCalls = 0;
    const result = await runPersonalAssistant({ ...input, surface: 'book-workspace', requestKey: 'book-request-1', message: 'Create a short book about decision making for leaders.' }, domain, {
      execute: async (_request, nextInput) => {
        modelCalls += 1;
        if (modelCalls === 1) {
          expect(nextInput.tools?.map(({ name }) => name)).toEqual(['book_create_context', 'book_write']);
          expect(nextInput.systemPrompt).toContain('Call book_create_context first');
          return response({ text: '', toolCalls: [{ id: 'book-context-1', name: 'book_create_context', arguments: brief }], stopReason: 'tool_use' });
        }
        if (modelCalls === 2) {
          expect(nextInput.messages.at(-1)).toMatchObject({ role: 'tool', content: [{ type: 'tool-result', result: { bookKey, status: 'planning' } }] });
          return response({ text: '', toolCalls: [{ id: 'book-write-1', name: 'book_write', arguments: { bookKey, ...brief } }], stopReason: 'tool_use' });
        }
        expect(nextInput.messages.at(-1)).toMatchObject({ role: 'tool', content: [{ type: 'tool-result', result: { bookKey, status: 'ready' } }] });
        return response({ text: 'Your book is ready in Ascend.', toolCalls: [], stopReason: 'end_turn' });
      },
      executeContent: (async (name: string, nextInput: any) => {
        contentCalls.push({ name, input: nextInput });
        return name === 'book.create-context' ? { bookKey, status: 'planning' } : { bookKey, status: 'ready' };
      }) as any,
    });

    expect(contentCalls).toEqual([
      { name: 'book.create-context', input: { scopeKey, ...brief, idempotencyKey: 'book-request-1:context' } },
      { name: 'book.write', input: { scopeKey, bookKey, ...brief, idempotencyKey: 'book-request-1:write' } },
    ]);
    expect(modelCalls).toBe(3);
    expect(result).toEqual({ type: 'answer', message: 'Your book is ready in Ascend.', sources: [] });
  });

  test('enforces the server-owned book creation sequence and matching brief', async () => {
    await expect(runPersonalAssistant({ ...input, surface: 'book-workspace' }, domain, {
      execute: async () => response({ text: '', toolCalls: [{ id: 'write-first', name: 'book_write', arguments: { bookKey: newId(), topic: 'Topic', goal: 'Goal', audience: 'Readers', tone: 'Clear', length: 'short', language: 'English' } }], stopReason: 'tool_use' }),
    })).rejects.toThrow('before creating');

    const bookKey = newId();
    let call = 0;
    await expect(runPersonalAssistant({ ...input, surface: 'book-workspace' }, domain, {
      execute: async () => {
        call += 1;
        return call === 1
          ? response({ text: '', toolCalls: [{ id: 'create', name: 'book_create_context', arguments: { topic: 'Topic', goal: 'Goal', audience: 'Readers', tone: 'Clear', length: 'short', language: 'English' } }], stopReason: 'tool_use' })
          : response({ text: '', toolCalls: [{ id: 'write', name: 'book_write', arguments: { bookKey, topic: 'Changed', goal: 'Goal', audience: 'Readers', tone: 'Clear', length: 'short', language: 'English' } }], stopReason: 'tool_use' });
      },
      executeContent: (async () => ({ bookKey, status: 'planning' })) as any,
    })).rejects.toThrow('did not match');
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
