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
      'archive_folder_list', 'archive_folder_create', 'archive_folder_update', 'archive_folder_move',
      'archive_document_list', 'archive_document_find', 'archive_document_create', 'archive_document_update',
      'archive_document_rename', 'archive_document_move', 'archive_document_copy', 'archive_document_translate',
      'archive_document_versions', 'archive_document_version_restore', 'archive_document_download', 'search_knowledge', 'write_note', 'unsupported_request',
    ]);
    expect(result).toEqual({ type: 'unsupported', message: 'This request is not supported in Archive. Core can search your documents or help write the open note.', sources: [] });
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
      'gallery_overview', 'gallery_collection_create', 'search_images', 'gallery_image_favorite', 'gallery_duplicates_find',
      'gallery_duplicates_delete', 'gallery_collection_transfer', 'gallery_subject_list', 'gallery_subject_create',
      'gallery_subject_images', 'gallery_subject_delete', 'gallery_subject_restore', 'gallery_upload_reserve',
      'gallery_upload_status', 'gallery_upload_complete', 'unsupported_request',
    ]);
    expect(chatInput.systemPrompt).toContain('Call search_images whenever');
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

    expect(chatInput.tools.map(({ name }: { name: string }) => name)).toEqual(['compass_overview', 'compass_place_create', 'compass_visit_create', 'compass_trip_create', 'compass_trip_place_add', 'compass_trip_place_remove', 'unsupported_request']);
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
        if (modelCalls === 1) return response({ text: '', toolCalls: [{ id: 'image-search-1', name: 'search_images', arguments: { query: 'red dog in snow' } }], stopReason: 'tool_use' });
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

  test('removes internal reasoning markup from user-visible responses', async () => {
    let modelCalls = 0;
    const result = await runPersonalAssistant(input, domain, {
      execute: async () => {
        modelCalls += 1;
        return modelCalls === 1
          ? response({ text: '<thinking>I should search first.</thinking>', toolCalls: [{ id: 'search-1', name: 'search_knowledge', arguments: { query: 'roadmap' } }], stopReason: 'tool_use' })
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
          ? response({ text: '', toolCalls: [{ id: 'image-1', name: 'search_images', arguments: { query: 'red dog' } }], stopReason: 'tool_use' })
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
          ? response({ text: '', toolCalls: [{ id: 'search-1', name: 'search_knowledge', arguments: { query: 'roadmap' } }], stopReason: 'tool_use' })
          : response({ text: '&lt;thinking&gt;Internal reasoning&lt;/thinking&gt;\n<response<The roadmap launches in October.</response<', toolCalls: [], stopReason: 'end_turn' });
      },
      executeContent: (async () => ({ query: 'roadmap', results: [{ documentKey, scopeKey, name: 'Roadmap', score: 0.9, snippet: 'Launch in October.' }], totalCandidates: 1 })) as any,
    });
    expect(result).toEqual({ type: 'answer', message: 'The roadmap launches in October.', sources: [{ documentKey, name: 'Roadmap' }] });
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
          expect(nextInput.tools?.map(({ name }) => name)).toEqual(['ascend_overview', 'ascend_detail', 'ascend_progress', 'book_create_context', 'book_write', 'unsupported_request']);
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
      { name: 'book.create-context', input: { scopeKey, ...brief, idempotencyKey: expect.stringMatching(/^[a-f0-9]{64}:context$/) } },
      { name: 'book.write', input: { scopeKey, bookKey, ...brief, idempotencyKey: expect.stringMatching(/^[a-f0-9]{64}:write$/) } },
    ]);
    expect(modelCalls).toBe(3);
    expect(result).toEqual({ type: 'answer', message: 'Your book is ready in Ascend.', sources: [], changes: [{ workspace: 'ascend' }] });
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

    let stoppedCall = 0;
    await expect(runPersonalAssistant({ ...input, surface: 'book-workspace' }, domain, {
      execute: async () => {
        stoppedCall += 1;
        return stoppedCall === 1
          ? response({ text: '', toolCalls: [{ id: 'create', name: 'book_create_context', arguments: { topic: 'Topic', goal: 'Goal', audience: 'Readers', tone: 'Clear', length: 'short', language: 'English' } }], stopReason: 'tool_use' })
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
      execute: async () => response({ text: '', toolCalls: [{ id: 'unsupported-1', name: 'unsupported_request', arguments: {} }], stopReason: 'tool_use' }),
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
          ? response({ text: '', toolCalls: [{ id: 'folder-1', name: 'archive_folder_create', arguments: { name: 'xyz' } }], stopReason: 'tool_use' })
          : response({ text: 'Created the xyz folder.', toolCalls: [], stopReason: 'end_turn' });
      },
      executeContent: (async (name: string, nextInput: any) => { calls.push({ name, input: nextInput }); return { results: [], summary: { requested: 1, succeeded: 1, failed: 0 } }; }) as any,
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.name).toBe('folder.create');
    expect(calls[0]?.input).toMatchObject({ folders: [{ scopeKey, name: 'xyz' }] });
    expect(calls[0]?.input.idempotencyKey).toMatch(/^([a-f0-9]{64}):archive_folder_create$/);
    expect(result).toEqual({ type: 'answer', message: 'Created the xyz folder.', sources: [], changes: [{ workspace: 'archive' }] });
  });

  test('strictly rejects unsupported control arguments', async () => {
    await expect(runPersonalAssistant(input, domain, {
      execute: async () => response({ text: '', toolCalls: [{ id: 'unsupported-1', name: 'unsupported_request', arguments: { reason: 'weather' } }], stopReason: 'tool_use' }),
    })).rejects.toThrow();
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
      inputSchema: z.object({}).strict(),
      definition: { name: 'future_capability', description: 'Future behavior.', inputSchema: { type: 'object' } },
      async execute() { return { kind: 'continue', result: {} }; },
    }).registerSurface('knowledge-workspace', ['future_capability']);
    expect(registry.resolve('knowledge-workspace').map(({ definition }) => definition.name)).toEqual(['future_capability']);
  });
});
