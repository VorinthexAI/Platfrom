import sharp from 'sharp';

const apiBase = (process.env.CORE_AGENT_E2E_API_URL ?? 'http://127.0.0.1:3001').replace(/\/$/, '');
const hostname = new URL(apiBase).hostname;
if (!['localhost', '127.0.0.1', '::1'].includes(hostname) && process.env.CORE_AGENT_E2E_DANGEROUS_REMOTE !== 'true') {
  throw new Error(`Refusing Core agent E2E against non-local host ${hostname}; set CORE_AGENT_E2E_DANGEROUS_REMOTE=true to override.`);
}

const paidImagesEnabled = process.argv.includes('--paid') || process.env.CORE_AGENT_E2E_PAID_IMAGE === 'true';
const turnTimeoutMs = positiveNumber('CORE_AGENT_E2E_TURN_TIMEOUT_MS', 120_000);
const asyncTimeoutMs = positiveNumber('CORE_AGENT_E2E_ASYNC_TIMEOUT_MS', 180_000);
const pollIntervalMs = positiveNumber('CORE_AGENT_E2E_POLL_INTERVAL_MS', 1_000);

function positiveNumber(name: string, fallback: number) {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${name} must be a positive number.`);
  return value;
}

function object(value: unknown, label = 'response'): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`Expected ${label} to be an object.`);
  return value as Record<string, unknown>;
}

function string(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value) throw new Error(`Missing ${label}.`);
  return value;
}

function array(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`Expected ${label} to be an array.`);
  return value;
}

function normalizedToken(value: string) {
  return value.trim().replace(/^["'`*_]+/, '').replace(/["'`*_.!,;:]+$/, '').trim();
}

interface TurnResult {
  content: string;
  deltaCount: number;
  firstDeltaMs: number | null;
  completionMs: number;
  userMessageKey: string;
  assistantMessageKey: string;
  message: Record<string, unknown>;
  retrievals: unknown[];
}

interface ScenarioResult {
  scenario: string;
  accurate: true;
  firstDeltaMs: number | null;
  completionMs: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  microSparks: number;
  transactions: string[];
  details: string;
}

interface BillingTransaction {
  key: string;
  kind: string;
  deltaMicroSparks: number;
  toolSlug?: string;
  actionSlug?: string;
  metadata?: Record<string, unknown>;
}

interface BillingSnapshot {
  microSparkBalance: number;
  transactions: BillingTransaction[];
}

interface UsageResult {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  microSparks: number;
  transactions: string[];
}

const suffix = crypto.randomUUID().replaceAll('-', '');
const shortSuffix = suffix.slice(0, 10);
const folderName = `Core agent E2E ${shortSuffix}`;
const directMarker = `DIRECT_${shortSuffix.toUpperCase()}`;
const recallMarker = `RECALL_${shortSuffix.toUpperCase()}`;
const documentMarker = `DOCUMENT_${shortSuffix.toUpperCase()}`;
const results: ScenarioResult[] = [];
const conversationKeys = new Set<string>();

let accessToken = '';
let refreshToken = '';
let teamKey = '';
let scopeKey = '';
let primaryConversationKey = '';
let folderKey: string | undefined;

function authHeaders(json = true): Record<string, string> {
  return {
    authorization: `Bearer ${accessToken}`,
    ...(json ? { 'content-type': 'application/json' } : {}),
    'x-refresh-token': refreshToken,
    'x-vorinthex-api-key': process.env.API_KEY ?? '',
    'x-vorinthex-session-transport': 'header',
  };
}

function captureRotatedTokens(response: Response) {
  accessToken = response.headers.get('x-access-token') ?? accessToken;
  refreshToken = response.headers.get('x-refresh-token') ?? refreshToken;
}

async function requestJson(path: string, options: { method?: string; body?: Record<string, unknown> } = {}) {
  const method = options.method ?? 'POST';
  const response = await fetch(`${apiBase}/api/v1${path}`, {
    method,
    headers: authHeaders(options.body !== undefined),
    ...(options.body ? { body: JSON.stringify(options.body) } : {}),
  });
  captureRotatedTokens(response);
  const text = await response.text();
  let payload: Record<string, unknown>;
  try { payload = object(JSON.parse(text), `${path} response`); }
  catch { throw new Error(`${method} ${path} returned invalid JSON with ${response.status}: ${text}`); }
  if (!response.ok) throw new Error(`${method} ${path} failed with ${response.status}: ${JSON.stringify(payload)}`);
  return payload;
}

async function api(path: string, body?: Record<string, unknown>, method = 'POST') {
  const payload = await requestJson(path, { method, ...(body ? { body } : {}) });
  if (payload.success !== true) throw new Error(`${method} ${path} returned an unsuccessful response: ${JSON.stringify(payload)}`);
  return object(payload.data, `${path} data`);
}

async function tool(name: string, input: Record<string, unknown>) {
  return api(`/content/tools/${name}`, { teamKey, scopeKey, input });
}

function parseSseFrame(source: string, index: number) {
  let event = '';
  let id = '';
  const data: string[] = [];
  for (const line of source.split('\n')) {
    if (!line || line.startsWith(':')) continue;
    const separator = line.indexOf(':');
    const field = separator < 0 ? line : line.slice(0, separator);
    const value = separator < 0 ? '' : line.slice(separator + 1).replace(/^ /, '');
    if (field === 'event') event = value;
    else if (field === 'id') id = value;
    else if (field === 'data') data.push(value);
  }
  if (!event || !id || !data.length) throw new Error(`Malformed SSE frame ${index}: ${JSON.stringify(source)}`);
  try { return { event, id, data: object(JSON.parse(data.join('\n')), `SSE ${event} data`) }; }
  catch { throw new Error(`SSE frame ${index} contained invalid JSON: ${data.join('\n')}`); }
}

async function turn(label: string, message: string, options: { conversationKey?: string; attachmentKeys?: string[]; requestKey?: string; allowPendingImage?: boolean } = {}): Promise<TurnResult> {
  const conversationKey = options.conversationKey ?? primaryConversationKey;
  if (!conversationKey) throw new Error('Conversation has not been created.');
  const requestKey = options.requestKey ?? `core-agent-e2e-${label}-${suffix}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(new Error(`${label} turn exceeded ${turnTimeoutMs}ms.`)), turnTimeoutMs);
  const startedAt = performance.now();
  try {
    const response = await fetch(`${apiBase}/api/v1/conversations/${conversationKey}/turn/stream`, {
      method: 'POST',
      headers: { ...authHeaders(), accept: 'text/event-stream' },
      body: JSON.stringify({ teamKey, scopeKey, message, requestKey, attachmentKeys: options.attachmentKeys ?? [] }),
      signal: controller.signal,
    });
    captureRotatedTokens(response);
    if (!response.ok) throw new Error(`${label} turn failed with ${response.status}: ${await response.text()}`);
    if (!(response.headers.get('content-type') ?? '').startsWith('text/event-stream')) throw new Error(`${label} turn did not return an SSE response.`);
    if (!response.body) throw new Error(`${label} turn returned no SSE body.`);

    let start: Record<string, unknown> | undefined;
    let done: Record<string, unknown> | undefined;
    let firstDeltaMs: number | null = null;
    let completionMs = 0;
    let frameIndex = 0;
    let buffer = '';
    const deltas: string[] = [];
    const processFrame = (source: string) => {
      const frame = parseSseFrame(source, ++frameIndex);
      if (done) throw new Error(`${label} turn emitted ${frame.event} after its terminal event.`);
      if (frame.data.correlationKey !== frame.id) throw new Error(`${label} turn SSE id did not match its correlation key.`);
      if (frame.event === 'error') throw new Error(`${label} turn returned ${String(frame.data.code)}: ${String(frame.data.message)}`);
      if (frame.event === 'start') {
        if (frameIndex !== 1 || start) throw new Error(`${label} turn emitted an invalid start event.`);
        if (frame.data.type !== 'start' || frame.data.conversationKey !== conversationKey) throw new Error(`${label} turn start event did not match the conversation.`);
        start = frame.data;
      } else if (frame.event === 'delta') {
        if (!start || frame.data.type !== 'delta' || frame.data.assistantMessageKey !== start.assistantMessageKey) throw new Error(`${label} turn emitted an invalid delta event.`);
        if (firstDeltaMs === null) firstDeltaMs = performance.now() - startedAt;
        deltas.push(string(frame.data.text, `${label} delta text`));
      } else if (frame.event === 'done') {
        if (!start || frame.data.type !== 'done' || frame.data.conversationKey !== conversationKey) throw new Error(`${label} turn emitted an invalid done event.`);
        completionMs = performance.now() - startedAt;
        done = frame.data;
      } else {
        throw new Error(`${label} turn emitted unknown SSE event ${JSON.stringify(frame.event)}.`);
      }
    };

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    while (true) {
      const chunk = await reader.read();
      buffer += decoder.decode(chunk.value, { stream: !chunk.done });
      buffer = buffer.replaceAll('\r\n', '\n');
      let separator = buffer.indexOf('\n\n');
      while (separator >= 0) {
        const frame = buffer.slice(0, separator).trim();
        buffer = buffer.slice(separator + 2);
        if (frame) processFrame(frame);
        separator = buffer.indexOf('\n\n');
      }
      if (chunk.done) break;
    }
    if (buffer.trim()) processFrame(buffer.trim());
    if (!start || !done) throw new Error(`${label} turn ended without start and done events.`);

    const completedMessage = object(done.message, `${label} completed message`);
    const expectedStatus = options.allowPendingImage ? ['PENDING', 'COMPLETED'] : ['COMPLETED'];
    const validIdentity = options.allowPendingImage ? completedMessage.type === 'IMAGE' : completedMessage.key === start.assistantMessageKey;
    if (completedMessage.role !== 'ASSISTANT' || !expectedStatus.includes(String(completedMessage.status)) || !validIdentity) throw new Error(`${label} turn completed with an invalid assistant message: ${JSON.stringify(completedMessage)}`);
    const content = string(completedMessage.content, `${label} assistant content`);
    const retrievals = array(completedMessage.retrievals ?? [], `${label} retrievals`);
    if (!options.allowPendingImage && deltas.length && deltas.join('') !== content) throw new Error(`${label} turn deltas did not reconstruct the completed assistant content.`);
    const roundedFirst = firstDeltaMs === null ? 'n/a' : `${Math.round(firstDeltaMs)}ms`;
    console.log(`${label}: first delta ${roundedFirst}, complete ${Math.round(completionMs)}ms, ${deltas.length} deltas`);
    return {
      content,
      deltaCount: deltas.length,
      firstDeltaMs,
      completionMs,
      userMessageKey: string(start.userMessageKey, `${label} user message key`),
      assistantMessageKey: string(completedMessage.key, `${label} assistant message key`),
      message: completedMessage,
      retrievals,
    };
  } finally {
    clearTimeout(timeout);
  }
}

function pass(scenario: string, result: TurnResult, usage: UsageResult, details: string, completionMs = result.completionMs) {
  results.push({ scenario, accurate: true, firstDeltaMs: result.firstDeltaMs, completionMs, ...usage, details });
}

async function createConversation(name: string) {
  const conversation = await api('/conversations', { teamKey, scopeKey, name });
  const key = string(conversation.key, 'conversation key');
  conversationKeys.add(key);
  return key;
}

async function prepareAttachment(label: string, filename: string, mimeType: string, bytes: Uint8Array) {
  const requestKey = `core-agent-e2e-${label}-${suffix}`;
  const reserved = await api(`/conversations/${primaryConversationKey}/attachments/uploads/presign`, {
    teamKey, scopeKey, requestKey,
    files: [{ clientKey: label, filename, mimeType, sizeBytes: bytes.byteLength }],
  });
  const upload = object(array(reserved.uploads, `${label} uploads`)[0], `${label} upload`);
  const uploadResponse = await fetch(string(upload.url, `${label} upload URL`), {
    method: 'PUT',
    headers: object(upload.headers, `${label} upload headers`) as Record<string, string>,
    body: Uint8Array.from(bytes).buffer,
  });
  if (!uploadResponse.ok) throw new Error(`${label} upload failed with ${uploadResponse.status}: ${await uploadResponse.text()}`);
  const attachmentKey = string(upload.attachmentKey, `${label} attachment key`);
  await api(`/conversations/${primaryConversationKey}/attachments/uploads/complete`, { teamKey, scopeKey, requestKey, attachmentKeys: [attachmentKey] });
  return { requestKey, attachmentKey };
}

async function listMessages(conversationKey = primaryConversationKey, limit = 100) {
  const response = await api(`/conversations/${conversationKey}/messages/list`, { teamKey, scopeKey, limit });
  return array(response.items, 'persisted messages').map((value, index) => object(value, `persisted message ${index + 1}`));
}

async function pollMessage(messageKey: string, predicate: (message: Record<string, unknown>) => boolean, label: string) {
  const deadline = Date.now() + asyncTimeoutMs;
  while (Date.now() < deadline) {
    const message = (await listMessages()).find((candidate) => candidate.key === messageKey);
    if (message && predicate(message)) return message;
    await Bun.sleep(pollIntervalMs);
  }
  throw new Error(`${label} did not converge within ${asyncTimeoutMs}ms.`);
}

function safeInteger(value: unknown, label: string) {
  if (!Number.isSafeInteger(value)) throw new Error(`Expected ${label} to be a safe integer.`);
  return value as number;
}

async function billingSummary(): Promise<BillingSnapshot> {
  const summary = await api('/billing/summary?limit=200', undefined, 'GET');
  return {
    microSparkBalance: safeInteger(summary.microSparkBalance, 'billing balance'),
    transactions: array(summary.transactions, 'billing transactions').map((value, index) => {
      const transaction = object(value, `billing transaction ${index + 1}`);
      return {
        key: string(transaction.key, `billing transaction ${index + 1} key`),
        kind: string(transaction.kind, `billing transaction ${index + 1} kind`),
        deltaMicroSparks: safeInteger(transaction.deltaMicroSparks, `billing transaction ${index + 1} delta`),
        ...(typeof transaction.toolSlug === 'string' ? { toolSlug: transaction.toolSlug } : {}),
        ...(typeof transaction.actionSlug === 'string' ? { actionSlug: transaction.actionSlug } : {}),
        ...(transaction.metadata && typeof transaction.metadata === 'object' ? { metadata: transaction.metadata as Record<string, unknown> } : {}),
      };
    }),
  };
}

async function metered<T>(operation: () => Promise<T>): Promise<{ value: T; usage: UsageResult }> {
  const before = await billingSummary();
  const value = await operation();
  const after = await billingSummary();
  const existing = new Set(before.transactions.map(({ key }) => key));
  const transactions = after.transactions.filter(({ key }) => !existing.has(key));
  const ledgerDebit = -transactions.reduce((total, transaction) => total + transaction.deltaMicroSparks, 0);
  const balanceDebit = before.microSparkBalance - after.microSparkBalance;
  if (ledgerDebit !== balanceDebit) throw new Error(`Billing ledger did not reconcile: balance debit ${balanceDebit}, transaction debit ${ledgerDebit}.`);
  const usage = transactions.reduce((total, transaction) => {
    const metadata = transaction.metadata ?? {};
    total.inputTokens += safeInteger(metadata.inputTokens ?? 0, `${transaction.key} inputTokens`);
    total.outputTokens += safeInteger(metadata.outputTokens ?? 0, `${transaction.key} outputTokens`);
    total.totalTokens += safeInteger(metadata.totalTokens ?? 0, `${transaction.key} totalTokens`);
    return total;
  }, { inputTokens: 0, outputTokens: 0, totalTokens: 0 });
  return {
    value,
    usage: {
      ...usage,
      microSparks: balanceDebit,
      transactions: transactions.map(({ kind, toolSlug, actionSlug, deltaMicroSparks }) => `${kind}:${actionSlug ?? toolSlug ?? 'unknown'}:${-deltaMicroSparks}`),
    },
  };
}

async function deleteFolderDirect(key: string) {
  await tool('folder.delete', { folderKeys: [key], recursive: false, atomic: false, idempotencyKey: `core-agent-e2e-cleanup-${suffix}` });
}

try {
  const health = await fetch(`${apiBase}/api/v1/health`);
  if (!health.ok) throw new Error(`Core agent E2E health check failed with ${health.status}.`);

  const guestResponse = await fetch(`${apiBase}/api/v1/auth/guest`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-vorinthex-session-transport': 'header' },
    body: JSON.stringify({
      distinctId: `app_core_agent_e2e_${suffix}`,
      bootstrapSecret: `guest_${crypto.randomUUID().replaceAll('-', '')}${crypto.randomUUID().replaceAll('-', '')}`,
    }),
  });
  if (!guestResponse.ok) throw new Error(`Guest bootstrap failed with ${guestResponse.status}: ${await guestResponse.text()}`);
  accessToken = string(guestResponse.headers.get('x-access-token'), 'access token');
  refreshToken = string(guestResponse.headers.get('x-refresh-token'), 'refresh token');
  const guest = object(await guestResponse.json(), 'guest response');
  teamKey = string(object(guest.team, 'guest team').key, 'team key');
  scopeKey = string(object(guest.scope ?? guest.main_scope, 'guest scope').key, 'scope key');

  primaryConversationKey = await createConversation(`Core agent live E2E ${shortSuffix}`);
  const memoryConversationKey = await createConversation(`Core recall source ${shortSuffix}`);

  const createdFolder = await tool('folder.create', { folders: [{ scopeKey, name: folderName, description: `Temporary Core E2E folder ${shortSuffix}` }], idempotencyKey: `core-agent-e2e-folder-${suffix}` });
  const createdFolderResult = object(array(createdFolder.results, 'folder.create results')[0], 'folder.create result');
  if (createdFolderResult.success !== true) throw new Error(`Folder creation failed: ${JSON.stringify(createdFolderResult)}`);
  folderKey = string(object(object(createdFolderResult.data, 'folder.create data').folder, 'created folder').key, 'created folder key');

  const { value: direct, usage: directUsage } = await metered(() => turn('direct', `Do not use any tools. Reply with exactly this text and nothing else: ${directMarker}`));
  if (direct.content.trim() !== directMarker || direct.deltaCount < 1 || direct.firstDeltaMs === null) throw new Error(`Direct response was not exact or streamed: ${JSON.stringify(direct.content)}`);
  pass('direct chat', direct, directUsage, 'Exact marker and incremental SSE deltas');

  const { value: publicWeb, usage: publicWebUsage } = await metered(() => turn('public-web', 'Hur mångs perros finns i Sverige'));
  if (!publicWeb.content.trim() || publicWeb.deltaCount < 1 || publicWeb.firstDeltaMs === null) throw new Error(`Public web response was empty or did not stream: ${JSON.stringify(publicWeb.content)}`);
  if (publicWeb.retrievals.length) throw new Error(`Public web question incorrectly searched private workspace data: ${JSON.stringify(publicWeb.retrievals)}`);
  if (publicWeb.content.includes(folderKey)) throw new Error('Public web answer exposed an internal key.');
  pass('native public web grounding', publicWeb, publicWebUsage, `Answered the Swedish public-data query without private workspace retrieval: ${publicWeb.content.replaceAll(/\s+/g, ' ').slice(0, 180)}`);

  const { value: searched, usage: searchedUsage } = await metered(() => turn('tool-search', `Which folder is named "${folderName}"? Use the exact workspace data and do not modify anything.`));
  if (searched.content.includes(folderKey)) throw new Error('Search answer exposed its internal key.');
  if (searched.retrievals.length !== 1) throw new Error(`Expected one search retrieval, received ${searched.retrievals.length}.`);
  const retrieval = object(searched.retrievals[0], 'folder retrieval');
  if (retrieval.limit !== 1 || JSON.stringify(retrieval.searchCollectionSlugs) !== JSON.stringify(['folders'])) throw new Error(`Core selected inaccurate search arguments: ${JSON.stringify(retrieval)}`);
  const searchResults = array(retrieval.groups, 'folder groups').flatMap((value, index) => array(object(value, `folder group ${index + 1}`).results, `folder group ${index + 1} results`));
  if (searchResults.length !== 1 || object(searchResults[0], 'folder result').key !== folderKey) throw new Error(`Search did not return only the isolated folder: ${JSON.stringify(searchResults)}`);
  pass('native app.search', searched, searchedUsage, 'One folders-only lookup with limit 1 and no leaked key');

  const { value: memory, usage: memoryUsage } = await metered(() => turn('recall-source', `Remember this private project codename for a later conversation: ${recallMarker}. Reply with exactly SAVED.`, { conversationKey: memoryConversationKey }));
  if (normalizedToken(memory.content).toUpperCase() !== 'SAVED') throw new Error(`Recall source acknowledgement was inaccurate: ${JSON.stringify(memory.content)}`);
  pass('recall source', memory, memoryUsage, 'Source turn persisted in a separate conversation');

  const checkpoints = Array.from({ length: 8 }, (_, index) => `CHECKPOINT_${index + 1}_${shortSuffix.toUpperCase()}`);
  let cumulativeConversationMicroSparks = 0;
  for (const [index, checkpoint] of checkpoints.entries()) {
    const label = `long-chat-${index + 1}`;
    const { value: checkpointTurn, usage } = await metered(() => turn(label, `Conversation checkpoint ${index + 1} is ${checkpoint}. Reply with exactly ACK_${index + 1}.`));
    if (normalizedToken(checkpointTurn.content).toUpperCase() !== `ACK_${index + 1}`) throw new Error(`${label} acknowledgement was inaccurate: ${JSON.stringify(checkpointTurn.content)}`);
    cumulativeConversationMicroSparks += usage.microSparks;
    pass(`long chat ${index + 1}/8`, checkpointTurn, usage, `Exact checkpoint acknowledgement; cumulative ${(cumulativeConversationMicroSparks / 1_000_000).toFixed(6)} Sparks`);
  }

  const longStart = `LONG_START_${shortSuffix.toUpperCase()}`;
  const longEnd = `LONG_END_${shortSuffix.toUpperCase()}`;
  const padding = Array.from({ length: 300 }, (_, index) => `Neutral verification sentence ${index + 1} contains no secret code.`).join(' ');
  const { value: longText, usage: longTextUsage } = await metered(() => turn('long-text', `The opening marker is ${longStart}. ${padding} The closing marker is ${longEnd}. Reply with exactly ${longStart}|${longEnd}.`));
  if (normalizedToken(longText.content).toUpperCase() !== `${longStart}|${longEnd}`) throw new Error(`Long-text extraction was inaccurate: ${JSON.stringify(longText.content)}`);
  cumulativeConversationMicroSparks += longTextUsage.microSparks;
  pass('long text extraction', longText, longTextUsage, `Exact markers across ${Buffer.byteLength(padding, 'utf8')} bytes; cumulative ${(cumulativeConversationMicroSparks / 1_000_000).toFixed(6)} Sparks`);

  const { value: oldContext, usage: oldContextUsage } = await metered(() => turn('old-context', `What were conversation checkpoints 1 and 8? Reply with exactly ${checkpoints[0]}|${checkpoints[7]}.`));
  if (normalizedToken(oldContext.content).toUpperCase() !== `${checkpoints[0]}|${checkpoints[7]}`) throw new Error(`Old-context answer was inaccurate: ${JSON.stringify(oldContext.content)}`);
  cumulativeConversationMicroSparks += oldContextUsage.microSparks;
  pass('old context accuracy', oldContext, oldContextUsage, `Recovered first and last checkpoints; cumulative ${(cumulativeConversationMicroSparks / 1_000_000).toFixed(6)} Sparks`);

  const { value: recalled, usage: recalledUsage } = await metered(() => turn('recall-target', 'What private project codename did I ask you to remember in another conversation? Reply with only the codename.'));
  if (normalizedToken(recalled.content).toUpperCase() !== recallMarker) throw new Error(`Semantic recall was inaccurate: ${JSON.stringify(recalled.content)}`);
  pass('cross-conversation recall', recalled, recalledUsage, 'Recovered exact private marker from scoped semantic memory after a long local conversation');

  const documentBytes = Buffer.from(`Core E2E verification document. The required answer is ${documentMarker}.`, 'utf8');
  const document = await prepareAttachment('document', `verification-${shortSuffix}.txt`, 'text/plain', documentBytes);
  const { value: documentTurn, usage: documentUsage } = await metered(async () => {
    const result = await turn('document', `Read the attached document and reply with exactly its required answer, with no other text.`, { requestKey: document.requestKey, attachmentKeys: [document.attachmentKey] });
    await pollMessage(result.userMessageKey, (message) => message.attachmentStatus === 'COMPLETED' && array(message.attachments ?? [], 'document attachments').length === 1, 'Document attachment persistence');
    return result;
  });
  if (normalizedToken(documentTurn.content).toUpperCase() !== documentMarker) throw new Error(`Document answer was inaccurate: ${JSON.stringify(documentTurn.content)}`);
  pass('document attachment', documentTurn, documentUsage, 'COMPLETED durable persistence and exact extraction answer');

  const redPng = await sharp({ create: { width: 96, height: 96, channels: 3, background: '#ff0000' } }).png().toBuffer();
  const image = await prepareAttachment('image-analysis', `red-${shortSuffix}.png`, 'image/png', redPng);
  const { value: imageTurn, usage: imageUsage } = await metered(async () => {
    const result = await turn('image-analysis', 'Inspect the attached image. Reply with exactly RED if its dominant color is red, otherwise reply with exactly NOT_RED.', { requestKey: image.requestKey, attachmentKeys: [image.attachmentKey] });
    await pollMessage(result.userMessageKey, (message) => message.attachmentStatus === 'COMPLETED' && array(message.attachments ?? [], 'image attachments').length === 1, 'Image attachment persistence');
    return result;
  });
  if (normalizedToken(imageTurn.content).toUpperCase() !== 'RED') throw new Error(`Image analysis was inaccurate: ${JSON.stringify(imageTurn.content)}`);
  if (imageTurn.retrievals.length) throw new Error(`Direct image analysis incorrectly searched workspace data: ${JSON.stringify(imageTurn.retrievals)}`);
  pass('image attachment', imageTurn, imageUsage, 'Dominant color identified directly with no workspace retrieval; attachment persisted');

  const { value: mixedContext, usage: mixedContextUsage } = await metered(() => turn('mixed-context', `Recall the earlier document answer and dominant image color. Reply with exactly ${documentMarker}|RED.`));
  if (normalizedToken(mixedContext.content).toUpperCase() !== `${documentMarker}|RED`) throw new Error(`Mixed-context answer was inaccurate: ${JSON.stringify(mixedContext.content)}`);
  pass('mixed attachment context', mixedContext, mixedContextUsage, 'Recovered exact document and image evidence after both durable attachment turns');

  if (paidImagesEnabled) {
    const editImage = await prepareAttachment('staged-edit', `edit-${shortSuffix}.png`, 'image/png', redPng);
    const editStartedAt = performance.now();
    const { value: edited, usage: editedUsage } = await metered(async () => {
      const result = await turn('staged-edit', 'Use the attached image as a reference and generate a new blue version. Use fast mode, low quality, and 1024x1024.', { requestKey: editImage.requestKey, attachmentKeys: [editImage.attachmentKey], allowPendingImage: true });
      await pollMessage(result.assistantMessageKey, (message) => message.type === 'IMAGE' && message.status === 'COMPLETED' && typeof message.imageKey === 'string', 'Staged image edit');
      return result;
    });
    if (edited.message.type !== 'IMAGE') throw new Error(`Staged edit did not create an image turn: ${JSON.stringify(edited.message)}`);
    pass('paid staged image edit', edited, editedUsage, `Queue accepted in ${Math.round(edited.completionMs)}ms; generated from a staged reference`, performance.now() - editStartedAt);

    const generationStartedAt = performance.now();
    const { value: generated, usage: generatedUsage } = await metered(async () => {
      const result = await turn('generate-image', 'Generate an image of a silver compass on a dark navy background. Use fast mode, low quality, and 1024x1024.', { allowPendingImage: true });
      await pollMessage(result.assistantMessageKey, (message) => message.type === 'IMAGE' && message.status === 'COMPLETED' && typeof message.imageKey === 'string', 'Image generation');
      return result;
    });
    if (generated.message.type !== 'IMAGE') throw new Error(`Image request did not create an image turn: ${JSON.stringify(generated.message)}`);
    pass('paid image generation', generated, generatedUsage, `Queue accepted in ${Math.round(generated.completionMs)}ms; generated image completed`, performance.now() - generationStartedAt);
  } else {
    console.log('Paid staged-edit and image-generation scenarios skipped; use test:e2e:core-agent-paid or set CORE_AGENT_E2E_PAID_IMAGE=true to run them.');
  }

  const persisted = await listMessages();
  if (persisted.some((message) => message.status === 'PENDING')) throw new Error('At least one primary-conversation message remained pending.');
  console.table(results.map((result) => ({
    scenario: result.scenario,
    accurate: result.accurate,
    firstDeltaMs: result.firstDeltaMs === null ? 'n/a' : Math.round(result.firstDeltaMs),
    completionMs: Math.round(result.completionMs),
    inputTokens: result.inputTokens,
    outputTokens: result.outputTokens,
    totalTokens: result.totalTokens,
    sparks: result.microSparks / 1_000_000,
    details: result.details,
  })));
  const totals = results.reduce((total, result) => ({
    inputTokens: total.inputTokens + result.inputTokens,
    outputTokens: total.outputTokens + result.outputTokens,
    totalTokens: total.totalTokens + result.totalTokens,
    microSparks: total.microSparks + result.microSparks,
  }), { inputTokens: 0, outputTokens: 0, totalTokens: 0, microSparks: 0 });
  console.log(JSON.stringify({ paidImagesEnabled, passed: results.length, failed: 0, totals: { ...totals, sparks: totals.microSparks / 1_000_000 }, results }, null, 2));
} finally {
  if (folderKey && accessToken) {
    try { await deleteFolderDirect(folderKey); }
    catch (error) { console.error('Core agent E2E folder cleanup failed.', error); }
  }
  for (const conversationKey of conversationKeys) {
    if (!accessToken) break;
    try { await api(`/conversations/${conversationKey}`, { teamKey, scopeKey }, 'DELETE'); }
    catch (error) { console.error(`Core agent E2E conversation cleanup failed for ${conversationKey}.`, error); }
  }
  if (accessToken) {
    try { await requestJson('/auth/me/delete', { body: { confirmation: 'DELETE MY ACCOUNT' } }); }
    catch (error) { console.error('Core agent E2E account cleanup failed.', error); }
  }
}
