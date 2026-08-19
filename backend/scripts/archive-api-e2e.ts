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

function minimalPdf(text: string) {
  const escaped = text.replace(/[\\()]/g, (character) => `\\${character}`);
  const stream = `BT /F1 12 Tf 72 720 Td (${escaped}) Tj ET`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
  ];
  let source = '%PDF-1.4\n';
  const offsets = [0];
  objects.forEach((objectValue, index) => {
    offsets.push(source.length);
    source += `${index + 1} 0 obj\n${objectValue}\nendobj\n`;
  });
  const xref = source.length;
  source += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.slice(1).map((offset) => `${String(offset).padStart(10, '0')} 00000 n `).join('\n')}\ntrailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new TextEncoder().encode(source);
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
    body: JSON.stringify({ organizationKey, scopeKey, input }),
  });
  const body = object(await response.json());
  accessToken = response.headers.get('x-access-token') ?? accessToken;
  refreshToken = response.headers.get('x-refresh-token') ?? refreshToken;
  if (!response.ok || body.success !== true) throw new Error(`${name} failed with ${response.status}: ${JSON.stringify(body)}`);
  return object(body.data);
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
  content: phrase,
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

const pdfPhrase = `PDF extraction verification ${suffix.slice(0, 8)} succeeded through AWS Textract.`;
const pdfBytes = minimalPdf(pdfPhrase);
const uploadedPdf = await tool('document.parse', {
  scopeKey,
  folderKey,
  file: {
    filename: 'archive-upload.pdf',
    mimeType: 'application/pdf',
    sizeBytes: pdfBytes.byteLength,
    encoding: 'base64',
    content: Buffer.from(pdfBytes).toString('base64'),
  },
  idempotencyKey: `archive-e2e-pdf-${suffix}`,
});
const uploadedPdfKey = string(object(uploadedPdf.document).key, 'uploaded PDF key');
const foundPdf = await tool('document.find', { documentKeys: [uploadedPdfKey], include: ['content'] });
const foundPdfDocument = object(object(object((foundPdf.results as unknown[])[0]).data).document);
if (typeof foundPdfDocument.content !== 'string' || !foundPdfDocument.content.includes(pdfPhrase)) throw new Error(`Uploaded PDF text was not persisted: ${JSON.stringify(foundPdfDocument)}`);

const fastFolderSearch = await tool('content.search', { scopeKey, query: folderName, includeSummaries: false });
if (!(fastFolderSearch.folders as unknown[]).some((entry) => object(entry).key === folderKey)) throw new Error('Fast search did not return the matching folder.');
const fastFileSearch = await tool('content.search', { scopeKey, folderKey, includeDescendants: true, query: 'silver observatory', includeSummaries: false });
const fastFile = (fastFileSearch.documents as unknown[]).map(object).find((entry) => entry.documentKey === uploadedDocumentKey);
if (!fastFile || fastFile.extension !== 'txt' || fastFile.summary !== undefined) throw new Error('Fast recursive search did not return the uploaded file without a summary.');

const listed = await tool('document.list', { scopeKey, folderKey, limit: 100, sort: { field: 'updatedAt', direction: 'desc' } });
if (!(listed.documents as unknown[]).some((entry) => object(entry).key === documentKey)) throw new Error('Created document was not listed.');

const query = `cobalt lighthouse ${suffix.slice(0, 8)}`;
const search = await tool('content.search', { scopeKey, query, minimumScore: 0 });
if (!(search.documents as unknown[]).some((entry) => object(entry).documentKey === documentKey)) throw new Error('Semantic retrieval did not return the created document.');
const replay = await tool('content.search', { scopeKey, query: `  ${query.toUpperCase()}  `, minimumScore: 0 });
if (!(replay.documents as unknown[]).some((entry) => object(entry).documentKey === documentKey)) throw new Error('Normalized semantic retrieval did not return the created document.');
const searchHistory = await tool('content.search-history.list', { scopeKey, limit: 8 });
const historyEntry = (searchHistory.history as unknown[]).map(object).find((entry) => entry.normalizedQuery === query && Number(entry.usageCount) >= 2);
if (!historyEntry) throw new Error('Semantic search history was not persisted.');
if (['contextDomain', 'documents', 'folderKey', 'includeDescendants', 'scopeKey'].some((field) => field in historyEntry)) throw new Error('Global search history exposed Archive context.');

await tool('document.delete', { documentKeys: [documentKey, uploadedDocumentKey, uploadedPdfKey], atomic: true });
await tool('document.delete', { documentKeys: [documentKey, uploadedDocumentKey, uploadedPdfKey], deleteVersions: true, deleteShares: true });
await tool('folder.delete', { folderKeys: [folderKey], recursive: true, atomic: true });

console.log('Archive API E2E passed: guest auth, folder/document creation, autosave, LocalStack upload, AWS PDF extraction, fast folder/file search, semantic retrieval, and history.');
