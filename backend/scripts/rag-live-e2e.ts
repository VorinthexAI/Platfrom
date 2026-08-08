import { Database } from 'arangojs';

if (process.env.RAG_E2E !== 'true') throw new Error('Refusing live RAG E2E without RAG_E2E=true.');
if (!process.env.OPENROUTER_API_KEY?.trim()) throw new Error('OPENROUTER_API_KEY is required for live RAG E2E.');
const url = process.env.ARANGO_URL ?? 'http://127.0.0.1:8529';
const parsedUrl = new URL(url);
const allowlisted = new Set(['localhost', '127.0.0.1', '::1', ...(process.env.RAG_E2E_ARANGO_HOST_ALLOWLIST ?? '').split(',').map((host) => host.trim()).filter(Boolean)]);
if (!allowlisted.has(parsedUrl.hostname) && process.env.RAG_E2E_DANGEROUS_REMOTE !== 'true') {
  throw new Error(`Refusing non-local, non-allowlisted Arango host ${parsedUrl.hostname}; set RAG_E2E_ARANGO_HOST_ALLOWLIST or the explicit dangerous override.`);
}

const databaseName = `rag_e2e_${crypto.randomUUID().replaceAll('-', '')}`;
const system = new Database({ url, auth: { username: process.env.ARANGO_USERNAME ?? 'root', password: process.env.ARANGO_ROOT_PASSWORD ?? '' } });
await system.createDatabase(databaseName);
process.env.ARANGO_DATABASE = databaseName;

try {
  const target = system.database(databaseName);
  await Promise.all(['documents', 'documentVersions', 'folders'].map((name) => target.createCollection(name)));
  const [{ embedText, EMBEDDING_DIMENSIONS }, { newId }, { insertPreparedDocument, semanticSearchContent }] = await Promise.all([
    import('../src/lib/embeddings'),
    import('../src/lib/ids'),
    import('../src/lib/db/documents.node'),
  ]);
  const authorizedScope = newId();
  const unauthorizedScope = newId();
  const now = new Date().toISOString();
  const folderByScope = new Map([[authorizedScope, newId()], [unauthorizedScope, newId()]]);
  for (const [scopeKey, key] of folderByScope) await target.collection('folders').save({ _key: key, scopeKey, name: 'RAG E2E', embedding: [], deletedAt: null, createdAt: now, updatedAt: now });
  const sources = [
    { name: 'Password reset guide', content: 'To regain account access, request a password reset email and follow the secure recovery link.', scopeKey: authorizedScope },
    { name: 'Office lunch menu', content: 'The cafeteria serves vegetable soup and sandwiches on Tuesday.', scopeKey: authorizedScope },
    { name: 'Foreign password guide', content: 'Reset credentials with the private administrator recovery console.', scopeKey: unauthorizedScope },
  ];
  const keys: string[] = [];
  for (const source of sources) {
    const key = newId();
    keys.push(key);
    const embedding = await embedText({ text: `${source.name}\n\n${source.content}`, purpose: 'document' });
    if (embedding.length !== EMBEDDING_DIMENSIONS || embedding.some((value) => !Number.isFinite(value))) throw new Error('Live document embedding is not finite 4096-dimensional data.');
    await insertPreparedDocument({ key, scopeKey: source.scopeKey, folderKey: folderByScope.get(source.scopeKey), name: source.name, html: `<p>${source.content}</p>`, content: source.content, isFavorite: false, embedding, deletedAt: null, createdAt: now, updatedAt: now });
  }
  const queryEmbedding = await embedText({ text: 'How can I recover access when I forgot my login password?', purpose: 'query' });
  if (queryEmbedding.length !== EMBEDDING_DIMENSIONS || queryEmbedding.some((value) => !Number.isFinite(value))) throw new Error('Live query embedding is not finite 4096-dimensional data.');
  const matches = await semanticSearchContent({ embedding: queryEmbedding, authorizedScopeKeys: [authorizedScope], limit: 10 });
  const relevant = matches.findIndex((match) => match.document.key === keys[0]);
  const unrelated = matches.findIndex((match) => match.document.key === keys[1]);
  if (relevant < 0 || unrelated < 0 || relevant >= unrelated) throw new Error('Relevant paraphrase did not rank above unrelated content.');
  if (matches.some((match) => match.document.key === keys[2])) throw new Error('Unauthorized scope content appeared in semantic retrieval.');
  console.log(`Live RAG E2E passed: relevant rank ${relevant + 1}, unrelated rank ${unrelated + 1}, vectors=${EMBEDDING_DIMENSIONS}.`);
} finally {
  await system.dropDatabase(databaseName).catch(() => {});
  system.close();
}
