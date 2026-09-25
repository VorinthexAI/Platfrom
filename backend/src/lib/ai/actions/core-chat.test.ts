import { describe, expect, test } from 'bun:test';
import { CORE_CHAT_MAX_FILE_BYTES, CORE_CHAT_MAX_IMAGE_BYTES, coreChatInputSchema } from './core-chat';

describe('core chat input', () => {
  test('requires at least one callable tool for trusted required-tool selection', () => {
    const messages = [{ role: 'user', content: [{ type: 'text', text: 'What is in this collection?' }] }];
    expect(() => coreChatInputSchema.parse({ messages, options: { toolChoice: 'required' } })).toThrow('needs a tool definition');
    expect(coreChatInputSchema.parse({ messages, tools: [{ name: 'agent.query', inputSchema: { type: 'object' } }], options: { toolChoice: 'required' } }).options?.toolChoice).toBe('required');
  });
  test('rejects trusted web grounding capabilities in model input', () => {
    const input = { messages: [{ role: 'user' as const, content: [{ type: 'text' as const, text: 'Hello' }] }] };
    expect(() => coreChatInputSchema.parse({ ...input, webGrounding: 'model-selected' })).toThrow();
    expect(() => coreChatInputSchema.parse({ ...input, capabilities: { webGrounding: 'model-selected' } })).toThrow();
  });

  test('accepts bounded images only in user messages', () => {
    expect(coreChatInputSchema.parse({ messages: [{ role: 'user', content: [{ type: 'image', mimeType: 'image/png', bytes: new Uint8Array([1]) }] }] }).messages).toHaveLength(1);
    expect(coreChatInputSchema.parse({ messages: [{ role: 'user', content: [{ type: 'file', filename: 'notes.pdf', mimeType: 'application/pdf', bytes: new Uint8Array([1]) }] }] }).messages).toHaveLength(1);
    expect(coreChatInputSchema.parse({ messages: [{ role: 'user', content: Array.from({ length: 12 }, (_, index) => ({ type: 'file' as const, filename: `${index}.txt`, mimeType: 'text/plain' as const, bytes: new Uint8Array([1]) })) }] }).messages[0]!.content).toHaveLength(12);
    expect(() => coreChatInputSchema.parse({ messages: [{ role: 'user', content: Array.from({ length: 13 }, (_, index) => ({ type: 'file' as const, filename: `${index}.txt`, mimeType: 'text/plain' as const, bytes: new Uint8Array([1]) })) }] })).toThrow('at most 12 attachments');
    expect(() => coreChatInputSchema.parse({ messages: [{ role: 'assistant', content: [{ type: 'image', mimeType: 'image/png', bytes: new Uint8Array([1]) }] }] })).toThrow('Images are allowed only in user messages');
    expect(() => coreChatInputSchema.parse({ messages: [{ role: 'assistant', content: [{ type: 'file', filename: 'notes.txt', mimeType: 'text/plain', bytes: new Uint8Array([1]) }] }] })).toThrow('Files are allowed only in user messages');
    const maximumFile = new Uint8Array(CORE_CHAT_MAX_FILE_BYTES);
    expect(() => coreChatInputSchema.parse({ messages: [{ role: 'user', content: [
      { type: 'file', filename: 'one.pdf', mimeType: 'application/pdf', bytes: maximumFile },
      { type: 'file', filename: 'two.pdf', mimeType: 'application/pdf', bytes: maximumFile },
      { type: 'file', filename: 'three.txt', mimeType: 'text/plain', bytes: new Uint8Array([1]) },
    ] }] })).toThrow('Chat file bytes');
  });

  test('rejects unsupported MIME types, unknown fields, and oversized images', () => {
    expect(() => coreChatInputSchema.parse({ messages: [{ role: 'user', content: [{ type: 'image', mimeType: 'image/gif', bytes: new Uint8Array([1]) }] }] })).toThrow();
    expect(() => coreChatInputSchema.parse({ messages: [{ role: 'user', content: [{ type: 'image', mimeType: 'image/png', bytes: new Uint8Array([1]), url: 'https://example.com' }] }] })).toThrow();
    expect(() => coreChatInputSchema.parse({ messages: [{ role: 'user', content: [{ type: 'image', mimeType: 'image/png', bytes: new Uint8Array(CORE_CHAT_MAX_IMAGE_BYTES + 1) }] }] })).toThrow();
  });
});
