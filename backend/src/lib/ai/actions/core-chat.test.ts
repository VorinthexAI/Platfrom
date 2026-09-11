import { describe, expect, test } from 'bun:test';
import { CORE_CHAT_MAX_IMAGE_BYTES, coreChatInputSchema } from './core-chat';

describe('core chat input', () => {
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
  });

  test('rejects unsupported MIME types, unknown fields, and oversized images', () => {
    expect(() => coreChatInputSchema.parse({ messages: [{ role: 'user', content: [{ type: 'image', mimeType: 'image/gif', bytes: new Uint8Array([1]) }] }] })).toThrow();
    expect(() => coreChatInputSchema.parse({ messages: [{ role: 'user', content: [{ type: 'image', mimeType: 'image/png', bytes: new Uint8Array([1]), url: 'https://example.com' }] }] })).toThrow();
    expect(() => coreChatInputSchema.parse({ messages: [{ role: 'user', content: [{ type: 'image', mimeType: 'image/png', bytes: new Uint8Array(CORE_CHAT_MAX_IMAGE_BYTES + 1) }] }] })).toThrow();
  });
});
