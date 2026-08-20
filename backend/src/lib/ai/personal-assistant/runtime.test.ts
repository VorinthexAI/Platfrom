import { describe, expect, test } from 'bun:test';
import { z } from 'zod';
import { newId } from '@/lib/ids';
import type { ToolContext } from '@/lib/ai/tools/tool-context';
import type { runContentTool } from '@/lib/ai/tools/content-runtime';
import { AssistantCapabilityRegistry } from './capabilities';
import { runPersonalAssistant } from './runtime';

const organizationKey = newId();
const scopeKey = newId();
const documentKey = newId();
const userKey = newId();
const domain = {
  organizationKey,
  runtimeScopeKey: scopeKey,
  principal: { kind: 'member', user: { key: userKey }, userOrganization: { key: newId(), organizationId: organizationKey, userId: userKey, status: 'active' } },
} as unknown as ToolContext;

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

    expect(request).toEqual({ mode: 'fixed', organizationKey, actionSlug: 'orchestrator-chat', modelSlug: 'openai.gpt-5.6-luna', providerSlug: 'openai' });
    expect(chatInput.tools.map(({ name }: { name: string }) => name)).toEqual([
      'content.hidden.list',
      'folder.hide', 'folder.reveal', 'document.hide', 'document.reveal',
      'folder.list', 'folder.create', 'folder.update', 'folder.move', 'folder.copy',
      'document.list', 'document.find', 'document.create', 'document.update',
      'document.rename', 'document.move', 'document.copy', 'document.summarize', 'document.topics', 'document.list-summaries', 'document.find-summary', 'document.audio.playback.update', 'document.audio.playback.clear', 'document.enhance', 'document.translate',
      'document.list-versions', 'document.restore-version', 'document.download', 'content.neighbors', 'content.search-history.delete', 'knowledge.search', 'note.write', 'assistant.unsupported',
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

  test('exposes canonical Gallery capabilities on the media workspace', async () => {
    let chatInput: any;
    const result = await runPersonalAssistant({ ...input, surface: 'media-workspace' }, domain, {
      execute: async (_request, nextInput) => {
        chatInput = nextInput;
        return response({ text: 'I can search your Gallery.', toolCalls: [], stopReason: 'end_turn' });
      },
    });

    expect(chatInput.tools.map(({ name }: { name: string }) => name)).toEqual([
      'content.hidden.list',
      'collection.list', 'collection.create', 'collection.update', 'collection.delete',
      'collection.member.list', 'collection.invite.pending.list', 'collection.invite.create', 'collection.invite.accept', 'collection.invite.reject', 'collection.invite.revoke',
      'collection.member.role.update', 'collection.member.remove', 'collection.leave', 'collection.share.list', 'collection.share.create', 'collection.share.update', 'collection.share.revoke', 'collection.share.activate',
      'image.search', 'image.favorite', 'image.update', 'image.delete',
      'collection.duplicates.delete', 'collection.image.transfer', 'subject.list', 'subject.create',
      'subject.image.list', 'subject.delete', 'highlight.create', 'highlight.list',
      'highlight.read', 'highlight.delete', 'image.create-memory', 'image.memory.list',
      'image.memory.read', 'image.memory.delete', 'collection.hide', 'collection.reveal',
      'image.hide', 'image.reveal', 'image.ideas.create', 'image.generate', 'assistant.unsupported',
    ]);
    expect(chatInput.systemPrompt).toContain('Call image.search whenever');
    expect(chatInput.systemPrompt).toContain('duplicates true plus collectionKey');
    expect(chatInput.messages[0].content[0].text).toContain('"workspace":"Gallery"');
    expect(result).toEqual({ type: 'unsupported', message: 'This request is not supported in Gallery. Core can search your images.', sources: [] });
  });

  test('executes image generation with trusted Core context and reports a Gallery mutation', async () => {
    let modelCalls = 0;
    const calls: unknown[][] = [];
    const result = await runPersonalAssistant({ ...input, surface: 'media-workspace', message: 'Generate an image of Earth', requestKey: 'request-1' }, domain, {
      execute: async () => {
        modelCalls += 1;
        if (modelCalls === 1) return response({ text: '', toolCalls: [{ id: 'generate-1', name: 'image.generate', arguments: { prompt: 'Earth from orbit', count: 1, size: '1024x1024', quality: 'high' } }], stopReason: 'tool_use' });
        return response({ text: 'Generated and saved the image.', toolCalls: [], stopReason: 'end_turn' });
      },
      images: { generate: async (...args: unknown[]) => { calls.push(args); return { images: [{ key: newId(), url: 'https://images.example/signed.png' }], provider: { durationMs: 10, costUsd: 0.1 } }; } } as any,
    });
    expect(calls).toEqual([[{ prompt: 'Earth from orbit', count: 1, size: '1024x1024', quality: 'high' }, domain, expect.stringMatching(/^[a-f0-9]{64}$/)]]);
    expect(calls[0]?.[2]).not.toBe('request-1');
    expect(result).toEqual({ type: 'answer', message: 'Generated and saved the image.', sources: [], changes: [{ workspace: 'gallery' }] });
  });

  test('exposes canonical Compass capabilities', async () => {
    let chatInput: any;
    const result = await runPersonalAssistant({ ...input, surface: 'travel-workspace' }, domain, {
      execute: async (_request, nextInput) => {
        chatInput = nextInput;
        return response({ text: 'Lisbon fits a relaxed long weekend.', toolCalls: [], stopReason: 'end_turn' });
      },
    });

    expect(chatInput.tools.map(({ name }: { name: string }) => name)).toEqual(['country.search', 'place.list', 'place.find', 'place.create', 'assistant.unsupported']);
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

    expect(searchInput).toEqual({ query: 'red dog in snow', recordHistory: true, limit: 50 });
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

  test('provides the trusted open document key for Core enhancement', async () => {
    let modelCalls = 0;
    let enhanceInput: unknown;
    const result = await runPersonalAssistant({ ...input, message: 'Enhance this document', currentNote: { ...input.currentNote, documentKey } }, domain, {
      execute: async () => {
        modelCalls += 1;
        if (modelCalls === 1) return response({ text: '', toolCalls: [{ id: 'enhance-1', name: 'document.enhance', arguments: {} }], stopReason: 'tool_use' });
        return response({ text: 'Enhanced the open document.', toolCalls: [], stopReason: 'end_turn' });
      },
      executeContent: (async (name: string, nextInput: unknown) => {
        enhanceInput = { name, input: nextInput };
        return { results: [{ success: true, data: { documentKey, text: 'Improved text.', persistedDocumentKey: documentKey } }], summary: { requested: 1, succeeded: 1, failed: 0 } };
      }) as any,
    });
    expect(enhanceInput).toEqual({ name: 'document.enhance', input: { documentKeys: [documentKey], mode: 'replace', idempotencyKey: expect.any(String) } });
    expect(result).toMatchObject({ type: 'answer', changes: [{ workspace: 'archive' }] });
  });

  test('creates a book through one canonical service call', async () => {
    const bookKey = newId();
    const brief = { topic: 'Decision making', goal: 'Make clearer decisions', audience: 'Curious leaders', tone: 'Warm and rigorous', length: 'short', language: 'English' } as const;
    const serviceCalls: unknown[][] = [];
    let modelCalls = 0;
    const result = await runPersonalAssistant({ ...input, surface: 'book-workspace', requestKey: 'book-request-1', message: 'Create a short book about decision making for leaders.' }, domain, {
      execute: async (_request, nextInput) => {
        modelCalls += 1;
        if (modelCalls === 1) {
          expect(nextInput.tools?.map(({ name }) => name)).toEqual(['book.list', 'book.detail', 'book.chapter.progress', 'book.create', 'assistant.unsupported']);
          expect(nextInput.systemPrompt).toContain('Call book.create exactly once');
          return response({ text: '', toolCalls: [{ id: 'book-create-1', name: 'book.create', arguments: brief }], stopReason: 'tool_use' });
        }
        expect(nextInput.messages.at(-1)).toMatchObject({ role: 'tool', content: [{ type: 'tool-result', result: { key: bookKey, status: 'ready' } }] });
        return response({ text: 'Your book is ready in Ascend.', toolCalls: [], stopReason: 'end_turn' });
      },
      books: { create: async (...args: unknown[]) => { serviceCalls.push(args); return { key: bookKey, status: 'ready' }; } } as any,
    });

    expect(serviceCalls).toEqual([[{ organizationKey, scopeKey, generationRequestKey: 'book-request-1', ...brief }, (domain.principal as any).user.key]]);
    expect(modelCalls).toBe(2);
    expect(result).toEqual({ type: 'answer', message: 'Your book is ready in Ascend.', sources: [], changes: [{ workspace: 'ascend' }] });
  });

  test('allows at most one book creation per assistant request', async () => {
    let call = 0;
    await expect(runPersonalAssistant({ ...input, surface: 'book-workspace' }, domain, {
      execute: async () => {
        call += 1;
        return response({ text: '', toolCalls: [{ id: `create-${call}`, name: 'book.create', arguments: { topic: 'Topic', goal: 'Goal', audience: 'Readers', tone: 'Clear', length: 'short', language: 'English' } }], stopReason: 'tool_use' });
      },
      books: { create: async () => ({ key: newId(), status: 'ready' }) } as any,
    })).rejects.toThrow('more than one book');
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
