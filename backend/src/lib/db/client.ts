import { Database } from 'arangojs';

const arangoUrl = process.env.ARANGO_URL ?? 'http://127.0.0.1:8529';
const arangoDatabaseName = process.env.ARANGO_DATABASE ?? 'vorinthex';
const arangoUsername = process.env.ARANGO_USERNAME ?? 'root';
const arangoPassword = process.env.ARANGO_ROOT_PASSWORD ?? '';

const rootDb = new Database({
  url: arangoUrl,
  auth: { username: arangoUsername, password: arangoPassword },
});

export const db = rootDb.database(arangoDatabaseName);

export async function closeDb() {
  db.close();
}

export async function withTransaction<T>(
  collections: string[],
  fn: (trx: Awaited<ReturnType<typeof db.beginTransaction>>) => Promise<T>,
): Promise<T> {
  const trx = await db.beginTransaction({ write: collections, exclusive: collections });
  try {
    const result = await fn(trx);
    await trx.commit();
    return result;
  } catch (err) {
    await trx.abort();
    throw err;
  }
}
