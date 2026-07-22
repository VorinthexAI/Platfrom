import { describe, expect, test } from 'bun:test';
import type { ChatOutput, ProviderExecuteResponse } from '@/lib/ai/providers';
import { ask } from './ask';
import { ARCHIVE_TOOL_NAMES, CHORUS_TOOL_NAMES, TOOL_NAMES, runTool, streamTool } from '@/lib/ai/tools';

const response: ProviderExecuteResponse<ChatOutput> = {
  output: { text: 'A useful answer.', toolCalls: [], stopReason: 'stop' },
  usage: { inputTokens: 1, outputTokens: 2, totalTokens: 3 },
  providerId: 'openai',
  modelId: 'model-key',
  externalModelId: 'model-name',
};

describe('orchestrator chat tool', () => {
  test('exposes the registered tools', () => {
    expect(TOOL_NAMES).toEqual(['orchestrator.chat', ...ARCHIVE_TOOL_NAMES, ...CHORUS_TOOL_NAMES]);
  });

  test('sanitizes input and invokes the shared chat action', async () => {
    let received = '';
    const reply = await ask({ skill: 'You are Atlas.', message: 'hello 😀 <unsafe>!' }, {
      execute: async (_organizationKey, input) => {
        received = input.messages[0]!.content[0]!.type === 'text' ? input.messages[0]!.content[0]!.text : '';
        return response;
      },
    });

    expect(received).toBe('hello unsafe!');
    expect(reply).toBe('A useful answer.');
  });

  test('strips unsupported input until empty messages fail', async () => {
    await expect(ask({ skill: 'Atlas', message: '😀' }, {
      execute: async () => response,
    })).rejects.toThrow('message is empty after sanitization');
  });

  test('does not allow unknown tool input fields', async () => {
    await expect(runTool('orchestrator.chat', 'Atlas', { message: 'hello', tool: 'delete' } as never, {
      execute: async () => response,
    })).rejects.toThrow();
  });

  test('rejects tools outside the orchestrator allowlist', async () => {
    await expect(runTool('database.delete', 'Atlas', { message: 'hello' }, {
      execute: async () => response,
    })).rejects.toThrow();
  });

  test('requires archive context for document processing and every Archive tool', async () => {
    await expect(runTool('document.processing', '', {} as never)).rejects.toThrow('requires archiveContext');
    await expect(runTool('folder.find', '', { folderKeys: [] } as never)).rejects.toThrow('requires archiveContext');
  });

  test('streams chat action chunks through the unified tool', async () => {
    const chunks = [];
    for await (const chunk of streamTool('orchestrator.chat', 'Atlas', { message: 'hello 😀' }, {
      stream: async function* (_organizationKey, input) {
        expect(input.messages[0]!.content[0]!.type).toBe('text');
        yield { type: 'text-delta', text: 'Hello' };
        yield { type: 'done' };
      },
    })) chunks.push(chunk);
    expect(chunks).toEqual([{ type: 'text-delta', text: 'Hello' }, { type: 'done' }]);
  });
});
