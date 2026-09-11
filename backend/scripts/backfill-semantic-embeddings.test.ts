import { describe, expect, test } from 'bun:test';

describe('semantic embedding backfill', () => {
  test('dedicates an optimistic current-metadata pass to completed text conversation messages', async () => {
    const source = await Bun.file(new URL('./backfill-semantic-embeddings.ts', import.meta.url)).text();
    expect(source).toContain("'conversationMessages'");
    expect(source).toContain('message.type == "TEXT" && message.status == "COMPLETED"');
    expect(source).toContain('message.embeddingProvider != @provider');
    expect(source).toContain('message.embeddingDimensions != @dimensions');
    expect(source).toContain('message._rev == @revision');
    expect(source).toContain('message.content == @content');
    expect(source).toContain("embedText({ text: row.content, purpose: 'document' })");
    expect(source).toContain('MERGE({ embedding: @embedding }, @metadata)');
  });
});
