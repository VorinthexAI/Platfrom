import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Database } from 'arangojs';
import sharp from 'sharp';
import { Hono } from 'hono';
import type { ToolContext } from '../src/lib/ai/tools/tool-context';

// Uses real model transcription/embeddings and observed action billing. Test
// authentication and the debit ledger are injected; documents/objects are real
// and isolated in a temporary local database, with cleanup after the run.
const local = (value: string) => ['localhost', '127.0.0.1', '[::1]'].includes(new URL(value).hostname);
assert(local(process.env.ARANGO_URL ?? 'http://127.0.0.1:8529'), 'This test requires local ArangoDB');
assert(local(process.env.S3_ENDPOINT_URL ?? process.env.AWS_ENDPOINT_URL ?? ''), 'This test requires local object storage');
const databaseName = `document_ingestion_${randomUUID().replaceAll('-', '')}`;
process.env.ARANGO_DATABASE = databaseName;
process.env.ARANGO_USERNAME = 'root';
const root = new Database({ url: process.env.ARANGO_URL, auth: { username: 'root', password: process.env.ARANGO_ROOT_PASSWORD ?? '' } });
await root.createDatabase(databaseName);
const database = root.database(databaseName);
let cleanupObjects: (() => Promise<void>) | undefined;
let closeRuntime: (() => Promise<void>) | undefined;

function pdf(text: string) {
  const stream = `BT /F1 16 Tf 72 700 Td (${text}) Tj ET`;
  const objects = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>', '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 900 800] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>', '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>', `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`];
  let content = '%PDF-1.4\n';
  const offsets = [0];
  objects.forEach((value, index) => { offsets.push(content.length); content += `${index + 1} 0 obj\n${value}\nendobj\n`; });
  const xref = content.length;
  content += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.slice(1).map((offset) => `${String(offset).padStart(10, '0')} 00000 n `).join('\n')}\ntrailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(content);
}

try {
  for (const name of ['teams', 'users', 'scopes', 'userTeams', 'scopeMembers', 'scopeScopes', 'folders', 'documents', 'documentVersions', 'documentSummaries', 'documentAudioVersions', 'documentSummaryAudio', 'images', 'contentIdempotency', 'contentSearchQueries', 'storageDeletionJobs', 'storageObjects', 'storageRetentionStates', 'events', 'generatedDocumentBindings', 'tagAssignments']) await database.createCollection(name);
  const [{ newId }, { toArangoDoc }, { closeDb }, { calculateActionCostMicroSparks }, { createContentToolHandler }, { documentStorage }, { s3, S3_BUCKET }, { ListObjectsV2Command, DeleteObjectsCommand }] = await Promise.all([
    import('../src/lib/ids'), import('../src/lib/db/base'), import('../src/lib/db/client'), import('../src/lib/costs'), import('../src/api/content-tools'), import('../src/lib/ai/document-processing/storage'), import('../src/lib/s3'), import('@aws-sdk/client-s3'),
  ]);
  closeRuntime = closeDb;
  const teamKey = newId(), scopeKey = newId(), userKey = newId(), membershipKey = newId();
  cleanupObjects = async () => {
    for (const prefix of [`content/${scopeKey}/`, `content/${teamKey}/${scopeKey}/`]) {
      const objects = await s3.send(new ListObjectsV2Command({ Bucket: S3_BUCKET, Prefix: prefix }));
      if (objects.Contents?.length) await s3.send(new DeleteObjectsCommand({ Bucket: S3_BUCKET, Delete: { Objects: objects.Contents.map(({ Key }) => ({ Key })) } }));
    }
    s3.destroy();
  };
  for (const [collection, value] of [
    ['teams', { key: teamKey, name: 'Ingestion test' }],
    ['users', { key: userKey, name: 'Ingestion test user' }],
    ['scopes', { key: scopeKey, teamKey, name: 'Ingestion test', slug: scopeKey }],
    ['userTeams', { key: membershipKey, teamKey, userId: userKey, teamRole: 'owner', status: 'active' }],
    ['scopeMembers', { key: newId(), scopeKey, userTeamKey: membershipKey, role: 'owner', status: 'active' }],
  ] as const) await database.collection(collection).save(toArangoDoc(value));
  const context = { teamKey, runtimeScopeKey: scopeKey, principal: { kind: 'member', user: { key: userKey }, userTeam: { key: membershipKey, userId: userKey, teamKey, teamRole: 'owner', status: 'active' } } } as unknown as ToolContext;
  assert(context.principal.kind === 'member');
  const principal = context.principal;
  const charges: Array<Record<string, any>> = [];
  const app = new Hono().post('/content/tools/:tool', createContentToolHandler({
    getIdentity: async () => ({ key: userKey, identityType: 'user' }),
    serviceOptions: {
      resolveMembership: async () => principal.userTeam,
      resolveUser: async () => principal.user,
      authorizeScope: async () => ({ allowed: true }) as never,
      recordEvent: async () => undefined, appScopeKey: scopeKey,
      billing: { charge: async (_user, input) => { charges.push(input); return { status: 'applied', transaction: { key: newId() } } as never; }, refund: async () => ({ status: 'applied', transaction: { key: newId() } }) as never },
    },
  }));
  async function call(tool: string, input: Record<string, unknown>) {
    const response = await app.request(`/content/tools/${tool}`, { method: 'POST', headers: { 'content-type': 'application/json', ...(typeof input.idempotencyKey === 'string' ? { 'idempotency-key': input.idempotencyKey } : {}) }, body: JSON.stringify({ teamKey, scopeKey, input }) });
    const body = await response.json() as any;
    assert.equal(response.status, 200, `${tool}: ${JSON.stringify(body)}`);
    assert.equal(body.success, true);
    return body.data;
  }
  const folder = (await call('folder.create', { folders: [{ scopeKey, name: 'Upload and scan verification' }], idempotencyKey: newId() })).results[0].data.folder;
  const samples = [
    { filename: 'verification.txt', mimeType: 'text/plain', bytes: Buffer.from('Silver observatory upload verification.'), expected: 'Silver observatory' },
    { filename: 'verification.pdf', mimeType: 'application/pdf', bytes: pdf('Silver observatory PDF upload verification.'), expected: 'Silver observatory' },
  ];
  const documentKeys: string[] = [];
  for (const sample of samples) {
    const input = { scopeKey, folderKey: folder.key, file: { filename: sample.filename, mimeType: sample.mimeType, sizeBytes: sample.bytes.byteLength, encoding: 'base64', content: sample.bytes.toString('base64') }, idempotencyKey: newId() };
    const output = await call('document.parse', input);
    documentKeys.push(output.document.key);
    const detail = (await call('document.find', { documentKeys: [output.document.key], include: ['content'] })).results[0].data.document;
    assert(detail.content.includes(sample.expected));
    assert.equal(detail.folderKey, folder.key);
    const chargedBeforeReplay = charges.length;
    assert.equal((await call('document.parse', input)).document.key, output.document.key);
    assert.equal(charges.length, chargedBeforeReplay, 'A parsed document replay must not charge again');
    const stored = await database.collection('documents').document(output.document.key);
    assert(stored.embedding.length > 0 && stored.chunkEmbeddings.length > 0);
    assert.deepEqual(Buffer.from((await documentStorage.download(stored.storageKey)).bytes), sample.bytes);
    console.log(JSON.stringify({ check: sample.filename, http: 200, persisted: true, originalBytes: true, idempotentReplay: true }));
  }
  const page = await sharp(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="1800" height="1000"><rect width="100%" height="100%" fill="white"/><text x="80" y="180" font-family="Arial" font-size="64" fill="black">Silver observatory scan verification</text><text x="80" y="300" font-family="Arial" font-size="48" fill="black">Document camera processing works.</text></svg>')).png({ compressionLevel: 0 }).toBuffer();
  assert(page.byteLength > 4 * 1024 * 1024 && page.byteLength < 8 * 1024 * 1024);
  const scanInput = { scopeKey, folderKey: folder.key, name: 'Scan verification', pages: [{ filename: 'scan-page.png', mimeType: 'image/png', sizeBytes: page.byteLength, encoding: 'base64', content: page.toString('base64') }], idempotencyKey: newId() };
  const scanned = await call('document.parse', scanInput);
  documentKeys.push(scanned.document.key);
  const scanDetail = (await call('document.find', { documentKeys: [scanned.document.key], include: ['content'] })).results[0].data.document;
  assert(scanDetail.content.toLowerCase().includes('silver observatory'));
  assert.equal(scanDetail.folderKey, folder.key);
  assert.equal(scanned.document.sourceImageCount, 1);
  const chargedBeforeScanReplay = charges.length;
  assert.equal((await call('document.parse', scanInput)).document.key, scanned.document.key);
  assert.equal(charges.length, chargedBeforeScanReplay, 'A page import replay must not charge again');
  const storedScan = await database.collection('documents').document(scanned.document.key);
  assert((await documentStorage.download(storedScan.sourceStorageKeys[0])).bytes.byteLength > 0);
  const list = await call('document.list', { scopeKey, folderKey: folder.key, limit: 100 });
  assert(documentKeys.every((key) => list.documents.some((document: { key: string }) => document.key === key)));
  assert.equal(charges.length, 2, 'Only PDF and image transcription should debit text actions');
  for (const charge of charges) {
    assert.equal(charge.kind, 'action'); assert.equal(charge.actionSlug, 'text');
    assert.equal(charge.microSparks, calculateActionCostMicroSparks('text', charge.metadata));
  }
  console.log(JSON.stringify({ check: 'camera scan', bytes: page.byteLength, http: 200, persisted: true, sourceImage: true, idempotentReplay: true }));
  console.log(JSON.stringify({ result: 'PASS', documents: documentKeys.length, listedInFolder: true, backend: 'real ArangoDB and local S3', transcription: 'real text action with native file/image input', embeddings: 'real provider', actionDebits: charges.map(({ microSparks, metadata }) => ({ microSparks, inputTokens: metadata.inputTokens, outputTokens: metadata.outputTokens })), fixedToolDebits: 0, authenticationAndDebitLedger: 'isolated test fixtures', finishedAt: new Date().toISOString() }));
} finally {
  try { await cleanupObjects?.(); } finally {
    await closeRuntime?.();
    database.close();
    await root.dropDatabase(databaseName);
    root.close();
  }
}
