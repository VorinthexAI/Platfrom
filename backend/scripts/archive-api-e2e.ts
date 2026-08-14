export {};

const apiBase = (process.env.ARCHIVE_E2E_API_URL ?? 'http://127.0.0.1:3001').replace(/\/$/, '');
const hostname = new URL(apiBase).hostname;
if (!['localhost', '127.0.0.1', '::1'].includes(hostname) && process.env.ARCHIVE_E2E_DANGEROUS_REMOTE !== 'true') {
  throw new Error(`Refusing Archive API E2E against non-local host ${hostname}; set ARCHIVE_E2E_DANGEROUS_REMOTE=true to override.`);
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Expected an object response.');
  return value as Record<string, unknown>;
}

function string(value: unknown, label: string) {
  if (typeof value !== 'string' || !value) throw new Error(`Missing ${label}.`);
  return value;
}

function firstResultData(value: Record<string, unknown>, label: string) {
  const results = value.results;
  if (!Array.isArray(results) || !results[0]) throw new Error(`${label} returned no result: ${JSON.stringify(value)}`);
  const result = object(results[0]);
  if (result.success !== true || !result.data) throw new Error(`${label} failed: ${JSON.stringify(result)}`);
  return object(result.data);
}

const suffix = crypto.randomUUID().replaceAll('-', '');
const guestResponse = await fetch(`${apiBase}/api/v1/auth/guest`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', 'x-vorinthex-session-transport': 'header' },
  body: JSON.stringify({
    distinctId: `app_archive_api_e2e_${suffix}`,
    bootstrapSecret: `guest_${crypto.randomUUID().replaceAll('-', '')}${crypto.randomUUID().replaceAll('-', '')}`,
  }),
});
if (!guestResponse.ok) throw new Error(`Guest bootstrap failed with ${guestResponse.status}: ${await guestResponse.text()}`);
const guest = object(await guestResponse.json());
const organizationKey = string(object(guest.organization).key, 'organization key');
const scopeKey = string(object(guest.main_scope).key, 'scope key');
const agentKey = string(object(guest.content_execution).agent_key, 'content execution agent key');
let accessToken = string(guestResponse.headers.get('x-access-token'), 'access token');
let refreshToken = string(guestResponse.headers.get('x-refresh-token'), 'refresh token');

async function tool(name: string, input: Record<string, unknown>) {
  const response = await fetch(`${apiBase}/api/v1/content/tools/${name}`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${accessToken}`,
      'content-type': 'application/json',
      'x-refresh-token': refreshToken,
      'x-vorinthex-api-key': process.env.API_KEY ?? '',
      'x-vorinthex-session-transport': 'header',
    },
    body: JSON.stringify({ organizationKey, agentKey, input }),
  });
  const body = object(await response.json());
  accessToken = response.headers.get('x-access-token') ?? accessToken;
  refreshToken = response.headers.get('x-refresh-token') ?? refreshToken;
  if (!response.ok || body.success !== true) throw new Error(`${name} failed with ${response.status}: ${JSON.stringify(body)}`);
  let data = object(body.data);
  if (name === 'document.parse' && data.job) {
    const jobKey = string(object(data.job).key, 'document job key');
    const deadline = Date.now() + 30 * 60_000;
    while (data.job) {
      if (Date.now() >= deadline) throw new Error(`document.parse job ${jobKey} timed out.`);
      await new Promise((resolve) => setTimeout(resolve, 1_000));
      const status = await fetch(`${apiBase}/api/v1/content/document-jobs/${jobKey}`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${accessToken}`,
          'content-type': 'application/json',
          'x-refresh-token': refreshToken,
          'x-vorinthex-api-key': process.env.API_KEY ?? '',
          'x-vorinthex-session-transport': 'header',
        },
        body: JSON.stringify({ organizationKey, agentKey }),
      });
      const statusBody = object(await status.json());
      accessToken = status.headers.get('x-access-token') ?? accessToken;
      refreshToken = status.headers.get('x-refresh-token') ?? refreshToken;
      if (statusBody.success !== true) throw new Error(`document.parse status failed with ${status.status}: ${JSON.stringify(statusBody)}`);
      data = object(statusBody.data);
    }
  }
  return data;
}

const folderName = `Archive E2E ${suffix.slice(0, 8)}`;
const folderResult = await tool('folder.create', {
  folders: [{ scopeKey, name: folderName }],
  idempotencyKey: `archive-e2e-folder-${suffix}`,
});
const folder = firstResultData(folderResult, 'folder.create');
const folderKey = string(object(folder.folder).key, 'folder key');

const phrase = `The archive verification phrase is cobalt lighthouse ${suffix.slice(0, 8)}.`;
const documentResult = await tool('document.create', {
  scopeKey,
  folderKey,
  name: 'Archive verification note',
  representation: { content: phrase },
  idempotencyKey: `archive-e2e-document-${suffix}`,
});
const documentRecord = object(documentResult.document);
const documentKey = string(documentRecord.key, 'document key');

const found = await tool('document.find', { documentKeys: [documentKey], include: ['content'] });
const foundDocument = object(object(object((found.results as unknown[])[0]).data).document);
if (foundDocument.content !== phrase) throw new Error('Created document content could not be retrieved.');

const updatedPhrase = `${phrase} Retrieval remains available after autosave.`;
const update = await tool('document.update', {
  updates: [{ documentKey, content: updatedPhrase, createVersion: false, expectedUpdatedAt: string(documentRecord.updatedAt, 'document updatedAt') }],
  atomic: false,
  idempotencyKey: `archive-e2e-update-${suffix}`,
});
firstResultData(update, 'document.update');

const uploadText = `Uploaded archive document ${suffix.slice(0, 8)} contains a silver observatory.`;
const uploaded = await tool('document.parse', {
  scopeKey,
  folderKey,
  file: {
    filename: 'archive-upload.txt',
    mimeType: 'text/plain',
    sizeBytes: new TextEncoder().encode(uploadText).byteLength,
    encoding: 'base64',
    content: Buffer.from(uploadText).toString('base64'),
  },
  idempotencyKey: `archive-e2e-upload-${suffix}`,
});
const uploadedDocumentKey = string(object(uploaded.document).key, 'uploaded document key');

const fastFolderSearch = await tool('scope.content.search', { scopeKey, query: folderName, includeSummaries: false });
if (!(fastFolderSearch.folders as unknown[]).some((entry) => object(entry).key === folderKey)) throw new Error('Fast search did not return the matching folder.');
const fastFileSearch = await tool('scope.content.search', { scopeKey, folderKey, includeDescendants: true, query: 'silver observatory', includeSummaries: false });
const fastFile = (fastFileSearch.documents as unknown[]).map(object).find((entry) => entry.documentKey === uploadedDocumentKey);
if (!fastFile || fastFile.extension !== 'txt' || fastFile.summary !== undefined) throw new Error('Fast recursive search did not return the uploaded file without a summary.');

const listed = await tool('document.list', { scopeKey, folderKey, limit: 100, sort: { field: 'updatedAt', direction: 'desc' } });
if (!(listed.documents as unknown[]).some((entry) => object(entry).key === documentKey)) throw new Error('Created document was not listed.');

const query = `cobalt lighthouse ${suffix.slice(0, 8)}`;
const search = await tool('scope.content.search', { scopeKey, query, minimumScore: 0 });
if (!(search.documents as unknown[]).some((entry) => object(entry).documentKey === documentKey)) throw new Error('Semantic retrieval did not return the created document.');
const replay = await tool('scope.content.search', { scopeKey, query: `  ${query.toUpperCase()}  `, minimumScore: 0 });
if (!(replay.documents as unknown[]).some((entry) => object(entry).documentKey === documentKey)) throw new Error('Normalized semantic retrieval did not return the created document.');
const searchHistory = await tool('scope.content.search-history', { scopeKey, limit: 8 });
if (!(searchHistory.history as unknown[]).some((entry) => object(entry).normalizedQuery === query && Number(object(entry).count) >= 2)) throw new Error('Semantic search history was not persisted.');

await tool('document.archive', { documentKeys: [documentKey, uploadedDocumentKey], atomic: true });
await tool('document.delete', { documentKeys: [documentKey, uploadedDocumentKey], deleteVersions: true, deleteShares: true });
await tool('folder.archive', { folderKeys: [folderKey], atomic: true });

console.log('Archive API E2E passed: guest auth, folder/document creation, autosave, upload, fast folder/file search, semantic retrieval, and history.');
