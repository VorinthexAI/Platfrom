import { db } from '../src/lib/db/client';
import { embeddingMetadata, embedText } from '../src/lib/bedrock-titan';

const BATCH_SIZE = 50;
let processed = 0;

while (true) {
  const cursor = await db.query<{ key: string; content: string }>(`
    FOR message IN messages
      FILTER message.deletedAt == null
      FILTER message.embeddingState != "ready" || !IS_ARRAY(message.embedding) || LENGTH(message.embedding) == 0
      SORT message._key ASC
      LIMIT @limit
      RETURN { key: message._key, content: message.content }
  `, { limit: BATCH_SIZE });
  const messages = await cursor.all();
  if (!messages.length) break;

  for (const message of messages) {
    const embedding = await embedText({ text: message.content });
    if (!embedding.length) throw new Error('Titan returned no embedding. Check the Bedrock AWS credentials before retrying the backfill.');
    const embeddedAt = new Date().toISOString();
    await db.collection('messages').update(message.key, {
      embedding,
      embeddingState: 'ready',
      embeddingDimensions: embedding.length,
      embeddedAt,
      ...embeddingMetadata(),
    });
    processed += 1;
  }
  console.log(`Backfilled ${processed} message embeddings.`);
}

console.log(`Message embedding backfill complete. Updated ${processed} messages.`);
