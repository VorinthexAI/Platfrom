import { describe, expect, test } from 'bun:test';
import { z } from 'zod';
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
  test('rejects direct model answers before a scoped tool executes', async () => {
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
    expect(chatInput.tools.map(({ name }: { name: string }) => name)).toEqual([
      'folder.list', 'folder.create', 'folder.update', 'folder.move',
      'document.list', 'document.find', 'document.create', 'document.update',
      'document.rename', 'document.move', 'document.copy', 'document.translate',
      'document.list-versions', 'document.restore-version', 'document.download', 'knowledge.search', 'note.write', 'note.enhance', 'assistant.unsupported',
    ]);
    expect(result).toEqual({ type: 'unsupported', message: 'This request is not supported in Archive. Core can search your documents or help write the open note.', sources: [] });
  });

  test('provides the trusted open document key for Core translation', async () => {
    let modelCalls = 0;
    let translationInput: unknown;
    const result = await runPersonalAssistant({ ...input, message: 'Translate this note to Spanish', currentNote: { ...input.currentNote, documentKey } }, domain, {
      execute: async (_request, nextInput) => {
        modelCalls += 1;
        expect(nextInput.messages[0].content[0]).toMatchObject({ type: 'text', text: expect.stringContaining(`\"documentKey\":\"${documentKey}\"`) });
        if (modelCalls === 1) return response({ text: '', toolCalls: [{ id: 'translate-1', name: 'document.translate', arguments: { targetLanguage: 'Spanish' } }], stopReason: 'tool_use' });
        return response({ text: 'Translated the open note.', toolCalls: [], stopReason: 'end_turn' });
      },
      executeContent: (async (_name: Parameters<typeof runContentTool>[0], nextInput: Parameters<typeof runContentTool>[1]) => {
        translationInput = nextInput;
        return { results: [{ success: true, data: { text: 'Texto', persistedDocumentKey: documentKey } }], summary: { requested: 1, succeeded: 1, failed: 0 } };
      }) as any,
    });
    expect(translationInput).toMatchObject({ documentKeys: [documentKey], targetLanguage: 'Spanish', mode: 'replace' });
    expect(result).toMatchObject({ type: 'answer', changes: [{ workspace: 'archive' }] });
  });

  test('exposes only image search on the media workspace', async () => {
    let chatInput: any;
    const result = await runPersonalAssistant({ ...input, surface: 'media-workspace' }, domain, {
      execute: async (_request, nextInput) => {
        chatInput = nextInput;
        return response({ text: 'I can search your Gallery.', toolCalls: [], stopReason: 'end_turn' });
      },
    });

    expect(chatInput.tools.map(({ name }: { name: string }) => name)).toEqual([
      'collection.list', 'collection.create', 'image.search', 'image.favorite', 'image.delete',
      'collection.duplicates.delete', 'collection.image.transfer', 'subject.list', 'subject.create',
      'subject.image.list', 'subject.delete', 'subject.restore', 'image.upload.reserve',
      'image.upload.status', 'image.upload.complete', 'assistant.unsupported',
    ]);
    expect(chatInput.systemPrompt).toContain('Call image.search whenever');
    expect(chatInput.systemPrompt).toContain('duplicates true plus collectionKey');
    expect(chatInput.messages[0].content[0].text).toContain('"workspace":"Gallery"');
    expect(result).toEqual({ type: 'unsupported', message: 'This request is not supported in Gallery. Core can search your images.', sources: [] });
  });

  test('exposes canonical Compass capabilities', async () => {
    let chatInput: any;
    const result = await runPersonalAssistant({ ...input, surface: 'travel-workspace' }, domain, {
      execute: async (_request, nextInput) => {
        chatInput = nextInput;
        return response({ text: 'Lisbon fits a relaxed long weekend.', toolCalls: [], stopReason: 'end_turn' });
      },
    });

    expect(chatInput.tools.map(({ name }: { name: string }) => name)).toEqual(['place.list', 'place.create', 'place.visit.create', 'trip.create', 'trip.place.add', 'trip.place.remove', 'assistant.unsupported']);
    expect(chatInput.systemPrompt).toContain('operating inside Compass');
    expect(chatInput.messages[0].content[0].text).toContain('"workspace":"Compass"');
    expect(result).toEqual({ type: 'unsupported', message: 'This request is not supported in Compass. Core can search your saved knowledge for travel context.', sources: [] });
  });

  test('infers image search, executes it, and answers from the tool result', async () => {
    let modelCalls = 0;
    let searchInput: unknown;
    const result = await runPersonalAssistant({ ...input, surface: 'media-workspace', message: 'Show me photos of the red dog in snow' }, domain, {
      execute: async (_request, nextInput) => {
        modelCalls += 1;
        if (modelCalls === 1) return response({ text: '', toolCalls: [{ id: 'image-search-1', name: 'image.search', arguments: { query: 'red dog in snow' } }], stopReason: 'tool_use' });
        expect(nextInput.messages.at(-1)).toMatchObject({ role: 'tool', content: [{ type: 'tool-result', toolCallId: 'image-search-1' }] });
        return response({ text: 'I found one matching image of a red dog in snow.', toolCalls: [], stopReason: 'end_turn' });
      },
      gallery: { search: async (nextInput: unknown) => {
        searchInput = nextInput;
        return { query: 'red dog in snow', images: [{ key: newId(), filename: 'dog.jpg', caption: 'A red dog standing in snow.', mimeType: 'image/jpeg', sizeBytes: 100, width: 100, height: 100, isFavorite: false, createdAt: '2026-08-11T12:00:00.000Z', updatedAt: '2026-08-11T12:00:00.000Z', score: 0.94 }] };
      } },
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
        if (modelCalls === 1) return response({ text: '', toolCalls: [{ id: 'search-1', name: 'knowledge.search', arguments: { query: 'roadmap' } }], stopReason: 'tool_use' });
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

  test('removes internal reasoning markup from user-visible responses', async () => {
    let modelCalls = 0;
    const result = await runPersonalAssistant(input, domain, {
      execute: async () => {
        modelCalls += 1;
        return modelCalls === 1
          ? response({ text: '<thinking>I should search first.</thinking>', toolCalls: [{ id: 'search-1', name: 'knowledge.search', arguments: { query: 'roadmap' } }], stopReason: 'tool_use' })
          : response({ text: '<thinking>The launch is in October.</thinking>\n<response>The saved roadmap says the launch is in October.</response>', toolCalls: [], stopReason: 'end_turn' });
      },
      executeContent: (async () => ({ query: 'roadmap', results: [{ documentKey, scopeKey, name: 'Roadmap', score: 0.9, snippet: 'Launch in October.' }], totalCandidates: 1 })) as any,
    });
    expect(result).toEqual({ type: 'answer', message: 'The saved roadmap says the launch is in October.', sources: [{ documentKey, name: 'Roadmap' }] });
  });

  test('never exposes a reasoning-only final response', async () => {
    let modelCalls = 0;
    const result = await runPersonalAssistant({ ...input, surface: 'media-workspace' }, domain, {
      execute: async () => {
        modelCalls += 1;
        return modelCalls === 1
          ? response({ text: '', toolCalls: [{ id: 'image-1', name: 'image.search', arguments: { query: 'red dog' } }], stopReason: 'tool_use' })
          : response({ text: '<analysis>I found an image but forgot the response.</analysis>', toolCalls: [], stopReason: 'end_turn' });
      },
      gallery: { search: async () => ({ query: 'red dog', images: [] }) },
    });
    expect(result).toEqual({ type: 'answer', message: 'Core completed the Gallery search but could not provide a response.', sources: [] });
  });

  test('extracts responses from malformed and escaped protocol markers', async () => {
    let modelCalls = 0;
    const result = await runPersonalAssistant(input, domain, {
      execute: async () => {
        modelCalls += 1;
        return modelCalls === 1
          ? response({ text: '', toolCalls: [{ id: 'search-1', name: 'knowledge.search', arguments: { query: 'roadmap' } }], stopReason: 'tool_use' })
          : response({ text: '&lt;thinking&gt;Internal reasoning&lt;/thinking&gt;\n<response<The roadmap launches in October.</response<', toolCalls: [], stopReason: 'end_turn' });
      },
      executeContent: (async () => ({ query: 'roadmap', results: [{ documentKey, scopeKey, name: 'Roadmap', score: 0.9, snippet: 'Launch in October.' }], totalCandidates: 1 })) as any,
    });
    expect(result).toEqual({ type: 'answer', message: 'The roadmap launches in October.', sources: [{ documentKey, name: 'Roadmap' }] });
  });

  test('returns a structured full-note replacement from the write capability', async () => {
    const result = await runPersonalAssistant(input, domain, {
      execute: async () => response({ text: '', toolCalls: [{ id: 'write-1', name: 'note.write', arguments: { content: 'Rewritten text', message: 'Rewrote the note.' } }], stopReason: 'tool_use' }),
    });
    expect(result).toEqual({ type: 'note', content: 'Rewritten text', message: 'Rewrote the note.', sources: [] });
  });

  test('enhances selected text deterministically without changing surrounding text', async () => {
    const content = 'Keep before. This are teh sentence. Keep after.';
    const selected = 'This are teh sentence.';
    const start = content.indexOf(selected);
    let enhanceInput: unknown;
    const result = await runPersonalAssistant({ ...input, message: 'Enhance the selected text', currentNote: { title: 'Notes', content, selection: { start, end: start + selected.length } } }, domain, {
      execute: async () => response({ text: '', toolCalls: [{ id: 'enhance-1', name: 'note.enhance', arguments: { target: 'selection' } }], stopReason: 'tool_use' }),
      executeContent: (async (name: string, nextInput: unknown) => { enhanceInput = { name, input: nextInput }; return { content: 'This is the sentence.' }; }) as any,
    });
    expect(enhanceInput).toEqual({ name: 'enhance', input: { content: selected } });
    expect(result).toEqual({ type: 'note', content: 'Keep before. This is the sentence. Keep after.', message: 'Enhanced the selected text.', sources: [] });
  });

  test('enhances the complete open document through the proofreading action', async () => {
    let enhanceInput: unknown;
    const result = await runPersonalAssistant({ ...input, message: 'Fix the wording, grammar, and spelling mistakes' }, domain, {
      execute: async () => response({ text: '', toolCalls: [{ id: 'enhance-1', name: 'note.enhance', arguments: { target: 'document' } }], stopReason: 'tool_use' }),
      executeContent: (async (name: string, nextInput: unknown) => { enhanceInput = { name, input: nextInput }; return { content: 'Improved text.' }; }) as any,
    });
    expect(enhanceInput).toEqual({ name: 'enhance', input: { content: 'Existing text' } });
    expect(result).toMatchObject({ type: 'note', content: 'Improved text.' });
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
          expect(nextInput.tools?.map(({ name }) => name)).toEqual(['book.list', 'book.detail', 'book.chapter.progress', 'book.create-context', 'book.write', 'assistant.unsupported']);
          expect(nextInput.systemPrompt).toContain('Call book.create-context first');
          return response({ text: '', toolCalls: [{ id: 'book-context-1', name: 'book.create-context', arguments: brief }], stopReason: 'tool_use' });
        }
        if (modelCalls === 2) {
          expect(nextInput.messages.at(-1)).toMatchObject({ role: 'tool', content: [{ type: 'tool-result', result: { bookKey, status: 'planning' } }] });
          return response({ text: '', toolCalls: [{ id: 'book-write-1', name: 'book.write', arguments: { bookKey, ...brief } }], stopReason: 'tool_use' });
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
      { name: 'book.create-context', input: { scopeKey, ...brief, idempotencyKey: expect.stringMatching(/^[a-f0-9]{64}:context$/) } },
      { name: 'book.write', input: { scopeKey, bookKey, ...brief, idempotencyKey: expect.stringMatching(/^[a-f0-9]{64}:write$/) } },
    ]);
    expect(modelCalls).toBe(3);
    expect(result).toEqual({ type: 'answer', message: 'Your book is ready in Ascend.', sources: [], changes: [{ workspace: 'ascend' }] });
  });

  test('enforces the server-owned book creation sequence and matching brief', async () => {
    await expect(runPersonalAssistant({ ...input, surface: 'book-workspace' }, domain, {
      execute: async () => response({ text: '', toolCalls: [{ id: 'write-first', name: 'book.write', arguments: { bookKey: newId(), topic: 'Topic', goal: 'Goal', audience: 'Readers', tone: 'Clear', length: 'short', language: 'English' } }], stopReason: 'tool_use' }),
    })).rejects.toThrow('before creating');

    const bookKey = newId();
    let call = 0;
    await expect(runPersonalAssistant({ ...input, surface: 'book-workspace' }, domain, {
      execute: async () => {
        call += 1;
        return call === 1
          ? response({ text: '', toolCalls: [{ id: 'create', name: 'book.create-context', arguments: { topic: 'Topic', goal: 'Goal', audience: 'Readers', tone: 'Clear', length: 'short', language: 'English' } }], stopReason: 'tool_use' })
          : response({ text: '', toolCalls: [{ id: 'write', name: 'book.write', arguments: { bookKey, topic: 'Changed', goal: 'Goal', audience: 'Readers', tone: 'Clear', length: 'short', language: 'English' } }], stopReason: 'tool_use' });
      },
      executeContent: (async () => ({ bookKey, status: 'planning' })) as any,
    })).rejects.toThrow('did not match');

    let stoppedCall = 0;
    await expect(runPersonalAssistant({ ...input, surface: 'book-workspace' }, domain, {
      execute: async () => {
        stoppedCall += 1;
        return stoppedCall === 1
          ? response({ text: '', toolCalls: [{ id: 'create', name: 'book.create-context', arguments: { topic: 'Topic', goal: 'Goal', audience: 'Readers', tone: 'Clear', length: 'short', language: 'English' } }], stopReason: 'tool_use' })
          : response({ text: 'Your book is ready.', toolCalls: [], stopReason: 'end_turn' });
      },
      executeContent: (async () => ({ bookKey: newId(), status: 'planning' })) as any,
    })).rejects.toThrow('before writing');
  });

  test('rejects capabilities outside the server-selected surface allowlist', async () => {
    await expect(runPersonalAssistant(input, domain, {
      execute: async () => response({ text: '', toolCalls: [{ id: 'bad-1', name: 'delete_everything', arguments: {} }], stopReason: 'tool_use' }),
    })).rejects.toThrow('unavailable capability');
  });

  test('returns server-owned unsupported messages without executing a domain tool', async () => {
    let contentCalls = 0;
    const result = await runPersonalAssistant({ ...input, surface: 'travel-workspace', message: 'What is the weather today?' }, domain, {
      execute: async () => response({ text: '', toolCalls: [{ id: 'unsupported-1', name: 'assistant.unsupported', arguments: {} }], stopReason: 'tool_use' }),
      executeContent: (async () => { contentCalls += 1; return {}; }) as any,
    });
    expect(contentCalls).toBe(0);
    expect(result).toEqual({ type: 'unsupported', message: 'This request is not supported in Compass. Core can search your saved knowledge for travel context.', sources: [] });
  });

  test('infers and executes "create a folder named xyz" with server-owned scope and idempotency', async () => {
    const calls: Array<{ name: string; input: any }> = [];
    let modelCalls = 0;
    const result = await runPersonalAssistant({ ...input, message: 'create a folder named xyz' }, domain, {
      execute: async () => {
        modelCalls += 1;
        return modelCalls === 1
          ? response({ text: '', toolCalls: [{ id: 'folder-1', name: 'folder.create', arguments: { name: 'xyz' } }], stopReason: 'tool_use' })
          : response({ text: 'Created the xyz folder.', toolCalls: [], stopReason: 'end_turn' });
      },
      executeContent: (async (name: string, nextInput: any) => { calls.push({ name, input: nextInput }); return { results: [], summary: { requested: 1, succeeded: 1, failed: 0 } }; }) as any,
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.name).toBe('folder.create');
    expect(calls[0]?.input).toMatchObject({ folders: [{ scopeKey, name: 'xyz' }] });
    expect(calls[0]?.input.idempotencyKey).toMatch(/^([a-f0-9]{64}):folder\.create$/);
    expect(result).toEqual({ type: 'answer', message: 'Created the xyz folder.', sources: [], changes: [{ workspace: 'archive' }] });
  });

  test('strictly rejects unsupported control arguments', async () => {
    await expect(runPersonalAssistant(input, domain, {
      execute: async () => response({ text: '', toolCalls: [{ id: 'unsupported-1', name: 'assistant.unsupported', arguments: { reason: 'weather' } }], stopReason: 'tool_use' }),
    })).rejects.toThrow();
  });

  test('rejects truncated tool calls and bounds repeated searches', async () => {
    await expect(runPersonalAssistant(input, domain, {
      execute: async () => response({ text: '', toolCalls: [{ id: 'write-1', name: 'note.write', arguments: { content: 'Partial', message: 'Changed it.' } }], stopReason: 'max_tokens' }),
    })).rejects.toThrow('ended unexpectedly');

    let calls = 0;
    await expect(runPersonalAssistant(input, domain, {
      execute: async () => {
        calls += 1;
        return response({ text: '', toolCalls: [{ id: `search-${calls}`, name: 'knowledge.search', arguments: { query: 'roadmap' } }], stopReason: 'tool_use' });
      },
      executeContent: (async () => ({ query: 'roadmap', results: [], totalCandidates: 0 })) as any,
    })).rejects.toThrow('iteration limit');
    expect(calls).toBe(4);
  });

  test('supports independently configured surface registries', () => {
    const registry = new AssistantCapabilityRegistry().register({
      inputSchema: z.object({}).strict(),
      definition: { name: 'future.capability', description: 'Future behavior.', inputSchema: { type: 'object' } },
      async execute() { return { kind: 'continue', result: {} }; },
    }).registerSurface('knowledge-workspace', ['future.capability']);
    expect(registry.resolve('knowledge-workspace').map(({ definition }) => definition.name)).toEqual(['future.capability']);
  });
});
