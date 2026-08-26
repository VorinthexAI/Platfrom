import { describe, expect, test } from 'bun:test';
import { documentSemanticHash } from './chunking';
import { prepareDocumentRepresentation } from './representation';

describe('document representation preparation', () => {
  test('sanitizes persisted content and prepares canonical semantics from a caller-supplied source', async () => {
    let actionInput: { name: string; content: string } | undefined;
    const result = await prepareDocumentRepresentation({
      name: 'Managed message',
      content: '{"kind":"mail-message"}\r\n\r\n\r\n',
      semanticSource: ' Sender@example.com\r\n\r\nSubject\r\n\r\nBody ',
    }, {
      embeddingDimensions: 2,
      documentEmbed: async (input) => {
        actionInput = input;
        return { embedding: [1, 2] };
      },
    });

    expect(actionInput).toEqual({ name: 'Managed message', content: 'Sender@example.com\n\nSubject\n\nBody' });
    expect(result).toEqual({
      content: '{"kind":"mail-message"}',
      embedding: [1, 2],
      contentChunks: ['Sender@example.com\n\nSubject\n\nBody'],
      chunkEmbeddings: [[1, 2]],
      semanticChunkCount: 1,
      semanticContentHash: documentSemanticHash('Sender@example.com\n\nSubject\n\nBody'),
    });
  });

  test('rejects noncanonical vectors, chunks, counts, and hashes from the embedding action', async () => {
    const prepare = (result: Record<string, unknown>) => prepareDocumentRepresentation({ name: 'Note', content: 'Body' }, {
      embeddingDimensions: 2,
      documentEmbed: async () => ({ embedding: [1, 2], ...result }),
    });

    await expect(prepare({ embedding: [1] })).rejects.toThrow();
    await expect(prepare({ contentChunks: ['Different'] })).rejects.toThrow('canonical semantic source');
    await expect(prepare({ semanticChunkCount: 2 })).rejects.toThrow('chunk count');
    await expect(prepare({ semanticContentHash: 'a'.repeat(64) })).rejects.toThrow('content hash');
  });
});
