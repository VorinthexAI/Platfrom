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
  fn: (trx: Awaited<ReturnType<typeof db.beginTransaction>> & { query: typeof db.query }) => Promise<T>,
): Promise<T> {
  const trx = await db.beginTransaction({ write: collections, exclusive: collections });
  try {
    const transaction = Object.assign(trx, {
      query: ((query: Parameters<typeof db.query>[0], bindVars?: Parameters<typeof db.query>[1]) => trx.step(() => db.query(query as never, bindVars))) as typeof db.query,
    });
    const result = await fn(transaction);
    await trx.commit();
    return result;
  } catch (err) {
    await trx.abort();
    throw err;
  }
}
