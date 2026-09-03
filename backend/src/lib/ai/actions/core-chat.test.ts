import { describe, expect, test } from 'bun:test';
import { CORE_CHAT_MAX_IMAGE_BYTES, coreChatInputSchema } from './core-chat';

describe('core chat input', () => {
  test('accepts bounded images only in user messages', () => {
    expect(coreChatInputSchema.parse({ messages: [{ role: 'user', content: [{ type: 'image', mimeType: 'image/png', bytes: new Uint8Array([1]) }] }] }).messages).toHaveLength(1);
    expect(() => coreChatInputSchema.parse({ messages: [{ role: 'assistant', content: [{ type: 'image', mimeType: 'image/png', bytes: new Uint8Array([1]) }] }] })).toThrow('Images are allowed only in user messages');
  });

  test('rejects unsupported MIME types, unknown fields, and oversized images', () => {
    expect(() => coreChatInputSchema.parse({ messages: [{ role: 'user', content: [{ type: 'image', mimeType: 'image/gif', bytes: new Uint8Array([1]) }] }] })).toThrow();
    expect(() => coreChatInputSchema.parse({ messages: [{ role: 'user', content: [{ type: 'image', mimeType: 'image/png', bytes: new Uint8Array([1]), url: 'https://example.com' }] }] })).toThrow();
    expect(() => coreChatInputSchema.parse({ messages: [{ role: 'user', content: [{ type: 'image', mimeType: 'image/png', bytes: new Uint8Array(CORE_CHAT_MAX_IMAGE_BYTES + 1) }] }] })).toThrow();
  });
});
