export {};

const apiBase = (process.env.CORE_AGENT_E2E_API_URL ?? 'http://127.0.0.1:3001').replace(/\/$/, '');
const hostname = new URL(apiBase).hostname;
if (!['localhost', '127.0.0.1', '::1'].includes(hostname) && process.env.CORE_AGENT_E2E_DANGEROUS_REMOTE !== 'true') {
  throw new Error(`Refusing Core agent E2E against non-local host ${hostname}; set CORE_AGENT_E2E_DANGEROUS_REMOTE=true to override.`);
}

const turnTimeoutMs = Number(process.env.CORE_AGENT_E2E_TURN_TIMEOUT_MS ?? 120_000);
if (!Number.isFinite(turnTimeoutMs) || turnTimeoutMs <= 0) throw new Error('CORE_AGENT_E2E_TURN_TIMEOUT_MS must be a positive number.');

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

function includesExact(value: string, expected: string, label: string) {
  if (!value.includes(expected)) throw new Error(`${label} did not include ${JSON.stringify(expected)}: ${JSON.stringify(value)}`);
}

function successfulAgentResponse(value: string, label: string) {
  if (/\b(?:fail(?:ed|ure)?|cannot|could not|unable)\b/i.test(value)) throw new Error(`${label} reported a failure: ${JSON.stringify(value)}`);
}

interface TurnResult {
  content: string;
  deltaCount: number;
}

const suffix = crypto.randomUUID().replaceAll('-', '');
const shortSuffix = suffix.slice(0, 10);
const originalFolderName = `Core agent E2E ${shortSuffix}`;
const renamedFolderName = `Core agent E2E renamed ${shortSuffix}`;
const originalDescription = `Temporary Core agent E2E resource ${shortSuffix}`;
const updatedDescription = `Updated by Core agent E2E ${shortSuffix}`;
const directMarker = `DIRECT_${shortSuffix.toUpperCase()}`;

let accessToken = '';
let refreshToken = '';
let organizationKey = '';
let scopeKey = '';
let conversationKey: string | undefined;
let folderKey: string | undefined;

function authHeaders(): Record<string, string> {
  return {
    authorization: `Bearer ${accessToken}`,
    'content-type': 'application/json',
    'x-refresh-token': refreshToken,
    'x-vorinthex-api-key': process.env.API_KEY ?? '',
    'x-vorinthex-session-transport': 'header',
  };
}

function captureRotatedTokens(response: Response) {
  accessToken = response.headers.get('x-access-token') ?? accessToken;
  refreshToken = response.headers.get('x-refresh-token') ?? refreshToken;
}

async function api(path: string, body: Record<string, unknown>, method = 'POST') {
  const response = await fetch(`${apiBase}/api/v1${path}`, {
    method,
    headers: authHeaders(),
    body: JSON.stringify(body),
  });
  captureRotatedTokens(response);
  const text = await response.text();
  let payload: Record<string, unknown>;
  try { payload = object(JSON.parse(text), `${path} response`); }
  catch { throw new Error(`${method} ${path} returned invalid JSON with ${response.status}: ${text}`); }
  if (!response.ok || payload.success !== true) throw new Error(`${method} ${path} failed with ${response.status}: ${JSON.stringify(payload)}`);
  return object(payload.data, `${path} data`);
}

async function tool(name: string, input: Record<string, unknown>) {
  return api(`/content/tools/${name}`, { organizationKey, scopeKey, input });
}

function parseSseFrames(source: string): Array<{ event: string; id: string; data: Record<string, unknown> }> {
  return source.replaceAll('\r\n', '\n').split('\n\n').filter((frame) => frame.trim()).map((frame, index) => {
    let event = '';
    let id = '';
    const data: string[] = [];
    for (const line of frame.split('\n')) {
      if (!line || line.startsWith(':')) continue;
      const separator = line.indexOf(':');
      const field = separator < 0 ? line : line.slice(0, separator);
      const value = separator < 0 ? '' : line.slice(separator + 1).replace(/^ /, '');
      if (field === 'event') event = value;
      else if (field === 'id') id = value;
      else if (field === 'data') data.push(value);
    }
    if (!event || !id || !data.length) throw new Error(`Malformed SSE frame ${index + 1}: ${JSON.stringify(frame)}`);
    try { return { event, id, data: object(JSON.parse(data.join('\n')), `SSE ${event} data`) }; }
    catch { throw new Error(`SSE frame ${index + 1} contained invalid JSON: ${data.join('\n')}`); }
  });
}

async function turn(label: string, message: string): Promise<TurnResult> {
  if (!conversationKey) throw new Error('Conversation has not been created.');
  const requestKey = `core-agent-e2e-${label}-${suffix}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(new Error(`${label} turn exceeded ${turnTimeoutMs}ms.`)), turnTimeoutMs);
  const startedAt = performance.now();
  try {
    const response = await fetch(`${apiBase}/api/v1/conversations/${conversationKey}/turn/stream`, {
      method: 'POST',
      headers: { ...authHeaders(), accept: 'text/event-stream' },
      body: JSON.stringify({ organizationKey, scopeKey, message, requestKey }),
      signal: controller.signal,
    });
    captureRotatedTokens(response);
    const source = await response.text();
    if (!response.ok) throw new Error(`${label} turn failed with ${response.status}: ${source}`);
    if (!(response.headers.get('content-type') ?? '').startsWith('text/event-stream')) throw new Error(`${label} turn did not return an SSE response.`);

    const frames = parseSseFrames(source);
    let start: Record<string, unknown> | undefined;
    let done: Record<string, unknown> | undefined;
    const deltas: string[] = [];
    for (const [index, frame] of frames.entries()) {
      if (done) throw new Error(`${label} turn emitted ${frame.event} after its terminal event.`);
      if (frame.data.correlationKey !== frame.id) throw new Error(`${label} turn SSE id did not match its correlation key.`);
      if (frame.event === 'error') throw new Error(`${label} turn returned ${String(frame.data.code)}: ${String(frame.data.message)}`);
      if (frame.event === 'start') {
        if (index !== 0 || start) throw new Error(`${label} turn emitted an invalid start event.`);
        if (frame.data.type !== 'start' || frame.data.conversationKey !== conversationKey) throw new Error(`${label} turn start event did not match the conversation.`);
        start = frame.data;
      } else if (frame.event === 'delta') {
        if (!start || frame.data.type !== 'delta' || frame.data.assistantMessageKey !== start.assistantMessageKey) throw new Error(`${label} turn emitted an invalid delta event.`);
        deltas.push(string(frame.data.text, `${label} delta text`));
      } else if (frame.event === 'done') {
        if (!start || frame.data.type !== 'done' || frame.data.conversationKey !== conversationKey) throw new Error(`${label} turn emitted an invalid done event.`);
        done = frame.data;
      } else {
        throw new Error(`${label} turn emitted unknown SSE event ${JSON.stringify(frame.event)}.`);
      }
    }
    if (!start || !done) throw new Error(`${label} turn ended without start and done events.`);
    const completedMessage = object(done.message, `${label} completed message`);
    if (completedMessage.role !== 'ASSISTANT' || completedMessage.status !== 'COMPLETED' || completedMessage.key !== start.assistantMessageKey) throw new Error(`${label} turn completed with an invalid assistant message.`);
    const content = string(completedMessage.content, `${label} assistant content`);
    if (deltas.length && deltas.join('') !== content) throw new Error(`${label} turn deltas did not reconstruct the completed assistant content.`);
    console.log(`${label} passed in ${Math.round(performance.now() - startedAt)}ms (${deltas.length} deltas): ${content}`);
    return { content, deltaCount: deltas.length };
  } finally {
    clearTimeout(timeout);
  }
}

async function listFolders() {
  const result = await tool('folder.list', { scopeKey, includeDescendants: false, limit: 100 });
  return array(result.folders, 'folder.list folders').map((value, index) => object(value, `folder ${index + 1}`));
}

async function findFolder(key: string) {
  const result = await tool('folder.find', { folderKeys: [key] });
  const matches = array(result.results, 'folder.find results').map((value, index) => object(value, `folder.find result ${index + 1}`));
  const match = matches.find((value) => value.key === key && value.success === true);
  return match?.data ? object(object(match.data, 'folder.find data').folder, 'folder.find folder') : undefined;
}

async function deleteFolderDirect(key: string) {
  await tool('folder.delete', {
    folderKeys: [key],
    recursive: false,
    atomic: false,
    idempotencyKey: `core-agent-e2e-cleanup-${suffix}`,
  });
}

try {
  const guestResponse = await fetch(`${apiBase}/api/v1/auth/guest`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-vorinthex-session-transport': 'header' },
    body: JSON.stringify({
      distinctId: `app_core_agent_e2e_${suffix}`,
      bootstrapSecret: `guest_${crypto.randomUUID().replaceAll('-', '')}${crypto.randomUUID().replaceAll('-', '')}`,
    }),
  });
  if (!guestResponse.ok) throw new Error(`Guest bootstrap failed with ${guestResponse.status}: ${await guestResponse.text()}`);
  const guest = object(await guestResponse.json(), 'guest response');
  organizationKey = string(object(guest.organization, 'guest organization').key, 'organization key');
  scopeKey = string(object(guest.main_scope, 'guest main scope').key, 'scope key');
  accessToken = string(guestResponse.headers.get('x-access-token'), 'access token');
  refreshToken = string(guestResponse.headers.get('x-refresh-token'), 'refresh token');

  const conversation = await api('/conversations', { organizationKey, scopeKey, name: `Core agent live E2E ${shortSuffix}` });
  conversationKey = string(conversation.key, 'conversation key');

  const direct = await turn('direct', `Do not use any tools. Reply with exactly this text and nothing else: ${directMarker}`);
  if (direct.content.trim() !== directMarker) throw new Error(`Direct response was not exact: ${JSON.stringify(direct.content)}`);

  const searched = await turn('search', `Use app.search with collectionSlugs ["folders", "documents", "files"] to find resources matching "${directMarker}". Do not modify anything.`);
  if (!searched.content.trim()) throw new Error('Search response was empty.');

  const signalSearch = await turn('signal-search', `Use app.search with collectionSlugs ["inboxes", "email-tones", "email-messages", "email-drafts"] to find resources matching "${directMarker}". Do not modify anything.`);
  if (!signalSearch.content.trim()) throw new Error('Signal search response was empty.');

  const listed = await turn('list', 'Use app.search with operation "list" and collectionSlugs ["folders"] to list the root folders. Briefly report the result without modifying anything.');
  if (!listed.content.trim()) throw new Error('List response was empty.');

  const counted = await turn('favorite-book-count', 'How many favorite audio books do I have? Use the exact workspace data and do not modify anything.');
  if (!counted.content.trim()) throw new Error('Favorite book count response was empty.');

  const completedTrips = await turn('completed-trip-count', 'How many completed trips do I have? Use the exact workspace data and do not modify anything.');
  if (!completedTrips.content.trim()) throw new Error('Completed trip count response was empty.');

  const bookDates = await turn('favorite-book-dates', 'When were my favorite audio books created? Use the exact workspace data and do not modify anything.');
  if (!bookDates.content.trim()) throw new Error('Favorite book dates response was empty.');

  const messages = await api(`/conversations/${conversationKey}/messages/list`, { organizationKey, scopeKey, limit: 20 });
  const persisted = array(messages.items, 'persisted messages');
  if (persisted.length !== 14) throw new Error(`Expected 14 persisted messages for seven turns, received ${persisted.length}.`);
  if (persisted.some((value) => object(value, 'persisted message').status !== 'COMPLETED')) throw new Error('At least one persisted message was not completed.');

  console.log('Core agent live E2E passed: direct answer, app search/list/count, SSE protocol, canonical persistence checks, and conversation history.');
} finally {
  if (folderKey && accessToken) {
    try { await deleteFolderDirect(folderKey); }
    catch (error) { console.error('Core agent E2E folder cleanup failed.', error); }
  }
  if (conversationKey && accessToken) {
    try { await api(`/conversations/${conversationKey}`, { organizationKey, scopeKey }, 'DELETE'); }
    catch (error) { console.error('Core agent E2E conversation cleanup failed.', error); }
  }
}
