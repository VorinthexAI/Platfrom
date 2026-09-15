#!/usr/bin/env bun
import sharp from 'sharp';
import { createOpenRouterProvider } from '@/lib/ai/providers/openrouter';
import { coreAgent, executeCoreAgent } from '@/lib/ai/agents/core';
import type { ExecuteActionOptions } from '@/lib/ai/router';
import { newId } from '@/lib/ids';

const apiBase = (process.env.CORE_ATTACHMENT_EVAL_API_URL ?? 'http://127.0.0.1:3001').replace(/\/$/, '');
const hostname = new URL(apiBase).hostname;
if (!['localhost', '127.0.0.1', '::1'].includes(hostname) && process.env.CORE_ATTACHMENT_EVAL_DANGEROUS_REMOTE !== 'true') {
  throw new Error(`Refusing attachment evaluation against non-local host ${hostname}; set CORE_ATTACHMENT_EVAL_DANGEROUS_REMOTE=true to override.`);
}

const providerOnly = process.argv.includes('--provider-only');
const pipelineOnly = process.argv.includes('--pipeline-only');
const coreOnly = process.argv.includes('--core-only');
if ([providerOnly, pipelineOnly, coreOnly].filter(Boolean).length > 1) throw new Error('Use at most one of --provider-only, --core-only, and --pipeline-only.');
const repeatArgument = process.argv.find((argument) => argument.startsWith('--repeat='));
const repeat = Number(repeatArgument?.slice('--repeat='.length) ?? 1);
if (!Number.isSafeInteger(repeat) || repeat < 1 || repeat > 10) throw new Error('--repeat must be an integer from 1 to 10.');
const scenarioArgument = process.argv.find((argument) => argument.startsWith('--scenario='));
const scenarioName = scenarioArgument?.slice('--scenario='.length);
if (scenarioArgument && !scenarioName) throw new Error('--scenario requires a scenario name.');

const turnTimeoutMs = positiveNumber('CORE_ATTACHMENT_EVAL_TURN_TIMEOUT_MS', 120_000);
const persistenceTimeoutMs = positiveNumber('CORE_ATTACHMENT_EVAL_PERSISTENCE_TIMEOUT_MS', 180_000);
const pollIntervalMs = positiveNumber('CORE_ATTACHMENT_EVAL_POLL_INTERVAL_MS', 1_000);
const suffix = crypto.randomUUID().replaceAll('-', '').slice(0, 10).toUpperCase();

function positiveNumber(name: string, fallback: number) {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${name} must be a positive number.`);
  return value;
}

function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`Expected ${label} to be an object.`);
  return value as Record<string, unknown>;
}

function array(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`Expected ${label} to be an array.`);
  return value;
}

function string(value: unknown, label: string) {
  if (typeof value !== 'string' || !value) throw new Error(`Missing ${label}.`);
  return value;
}

function elapsed(startedAt: number) {
  return Math.round(performance.now() - startedAt);
}

type Fixture = {
  kind: 'image' | 'file';
  filename: string;
  mimeType: 'image/png' | 'image/jpeg' | 'text/plain';
  bytes: Uint8Array;
};

type Scenario = {
  name: string;
  prompt: string;
  expected: string;
  fixtures: Fixture[];
  firstTurn?: boolean;
};

type Metrics = {
  fixtureBytes: number;
  presignMs?: number;
  uploadMs?: number;
  slowestUploadMs?: number;
  canonicalizationMs?: number;
  sseOpenMs?: number;
  sseStartMs?: number;
  firstDeltaMs: number | null;
  lastDeltaMs?: number | null;
  doneMs?: number;
  terminalTailMs?: number | null;
  postLastDeltaMs?: number | null;
  persistenceMs?: number;
  totalMs: number;
  deltaCount: number;
};

type Result = {
  scenario: string;
  iteration: number;
  path: 'provider' | 'core' | 'pipeline';
  status: 'passed' | 'failed';
  accurate: boolean;
  prematureEof: boolean;
  detail: string;
  metrics: Metrics;
};

let accessToken = '';
let refreshToken = '';
let teamKey = 'core-attachment-live';
let scopeKey = '';
const conversationKeys = new Set<string>();
const results: Result[] = [];

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

async function requestJson(path: string, body?: Record<string, unknown>, method = 'POST') {
  const response = await fetch(`${apiBase}/api/v1${path}`, {
    method,
    headers: authHeaders(body !== undefined),
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  captureRotatedTokens(response);
  const text = await response.text();
  let payload: Record<string, unknown>;
  try { payload = object(JSON.parse(text), `${path} response`); }
  catch { throw new Error(`${method} ${path} returned invalid JSON with ${response.status}: ${text.slice(0, 500)}`); }
  if (!response.ok || payload.success !== true) throw new Error(`${method} ${path} failed with ${response.status}: ${JSON.stringify(payload)}`);
  return object(payload.data, `${path} data`);
}

async function deleteAccount() {
  const response = await fetch(`${apiBase}/api/v1/auth/me/delete`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ confirmation: 'DELETE MY ACCOUNT' }),
  });
  captureRotatedTokens(response);
  const text = await response.text();
  let payload: Record<string, unknown>;
  try { payload = object(JSON.parse(text), '/auth/me/delete response'); }
  catch { throw new Error(`POST /auth/me/delete returned invalid JSON with ${response.status}: ${text.slice(0, 500)}`); }
  if (!response.ok || payload.deleted !== true) throw new Error(`POST /auth/me/delete failed with ${response.status}: ${JSON.stringify(payload)}`);
}

async function createConversation(label: string) {
  const conversation = await requestJson('/conversations', { teamKey, scopeKey, name: `Attachment eval ${label} ${suffix}` });
  const key = string(conversation.key, 'conversation key');
  conversationKeys.add(key);
  return key;
}

function parseSseFrame(source: string) {
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
  if (!event || !data.length) throw new Error(`Malformed SSE frame: ${JSON.stringify(source)}`);
  return { event, id, data: object(JSON.parse(data.join('\n')), `${event} event`) };
}

async function uploadAttachments(conversationKey: string, requestKey: string, fixtures: Fixture[]) {
  if (!fixtures.length) return { attachmentKeys: [] as string[], presignMs: 0, uploadMs: 0, slowestUploadMs: 0, canonicalizationMs: 0 };
  const presignStarted = performance.now();
  const reserved = await requestJson(`/conversations/${conversationKey}/attachments/uploads/presign`, {
    teamKey, scopeKey, requestKey,
    files: fixtures.map((fixture, index) => ({ clientKey: `${requestKey}-${index}`, filename: fixture.filename, mimeType: fixture.mimeType, sizeBytes: fixture.bytes.byteLength })),
  });
  const presignMs = elapsed(presignStarted);
  const uploads = array(reserved.uploads, 'attachment uploads').map((value, index) => ({ fixture: fixtures[index]!, upload: object(value, `attachment upload ${index + 1}`) }));
  const uploadStarted = performance.now();
  const uploadDurations = await Promise.all(uploads.map(async ({ fixture, upload }, index) => {
    const startedAt = performance.now();
    const headers = Object.fromEntries(Object.entries(object(upload.headers, `attachment upload ${index + 1} headers`)).map(([name, value]) => [name, string(value, `upload header ${name}`)]));
    const response = await fetch(string(upload.url, `attachment upload ${index + 1} URL`), { method: 'PUT', headers, body: Uint8Array.from(fixture.bytes).buffer });
    if (!response.ok) throw new Error(`Attachment upload ${index + 1} failed with ${response.status}: ${await response.text()}`);
    return elapsed(startedAt);
  }));
  const uploadMs = elapsed(uploadStarted);
  const attachmentKeys = uploads.map(({ upload }, index) => string(upload.attachmentKey, `attachment upload ${index + 1} key`));
  const completionStarted = performance.now();
  await requestJson(`/conversations/${conversationKey}/attachments/uploads/complete`, { teamKey, scopeKey, requestKey, attachmentKeys });
  return { attachmentKeys, presignMs, uploadMs, slowestUploadMs: Math.max(...uploadDurations), canonicalizationMs: elapsed(completionStarted) };
}

async function streamPipelineTurn(conversationKey: string, requestKey: string, prompt: string, attachmentKeys: string[]) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(new Error(`Turn exceeded ${turnTimeoutMs}ms.`)), turnTimeoutMs);
  const startedAt = performance.now();
  let openedMs: number | undefined;
  let startMs: number | undefined;
  let firstDeltaMs: number | null = null;
  let lastDeltaMs: number | null = null;
  let doneMs: number | undefined;
  let userMessageKey = '';
  let content = '';
  let deltaCount = 0;
  try {
    const response = await fetch(`${apiBase}/api/v1/conversations/${conversationKey}/turn/stream`, {
      method: 'POST', headers: { ...authHeaders(), accept: 'text/event-stream' },
      body: JSON.stringify({ teamKey, scopeKey, message: prompt, requestKey, attachmentKeys }), signal: controller.signal,
    });
    captureRotatedTokens(response);
    openedMs = elapsed(startedAt);
    if (!response.ok) throw new Error(`Turn failed with ${response.status}: ${await response.text()}`);
    if (!response.body) throw new Error('Turn returned no SSE body.');
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let terminal = false;
    const processFrame = (source: string) => {
      const frame = parseSseFrame(source);
      if (terminal) throw new Error(`SSE emitted ${frame.event} after its terminal event.`);
      if (frame.id && frame.data.correlationKey !== frame.id) throw new Error('SSE id did not match its correlation key.');
      if (frame.event === 'start') {
        if (startMs !== undefined) throw new Error('SSE emitted more than one start event.');
        startMs = elapsed(startedAt);
        userMessageKey = string(frame.data.userMessageKey, 'user message key');
      } else if (frame.event === 'delta') {
        if (startMs === undefined) throw new Error('SSE emitted a delta before start.');
        lastDeltaMs = elapsed(startedAt);
        if (firstDeltaMs === null) firstDeltaMs = lastDeltaMs;
        content += string(frame.data.text, 'delta text');
        deltaCount += 1;
      } else if (frame.event === 'done') {
        if (startMs === undefined) throw new Error('SSE emitted done before start.');
        doneMs = elapsed(startedAt);
        terminal = true;
        content = string(object(frame.data.message, 'done message').content, 'done message content');
      } else if (frame.event === 'error') {
        terminal = true;
        throw new Error(`Core returned ${String(frame.data.code)}: ${String(frame.data.message)}`);
      } else throw new Error(`Unknown SSE event ${frame.event}.`);
    };
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
    if (!terminal) throw Object.assign(new Error(`Conversation stream ended before a terminal event (start=${startMs ?? 'none'}ms, firstDelta=${firstDeltaMs ?? 'none'}ms, bytes=${Buffer.byteLength(content)}).`), { prematureEof: true });
    return { content, userMessageKey, openedMs, startMs, firstDeltaMs, lastDeltaMs, doneMs, deltaCount };
  } finally {
    clearTimeout(timeout);
  }
}

async function waitForAttachments(conversationKey: string, userMessageKey: string, expectedCount: number) {
  if (!expectedCount) return 0;
  const startedAt = performance.now();
  const deadline = Date.now() + persistenceTimeoutMs;
  while (Date.now() < deadline) {
    const response = await requestJson(`/conversations/${conversationKey}/messages/list`, { teamKey, scopeKey, limit: 100 });
    const message = array(response.items, 'conversation messages').map((value, index) => object(value, `conversation message ${index + 1}`)).find(({ key }) => key === userMessageKey);
    if (message && message.attachmentStatus !== 'PENDING') {
      const count = array(message.attachments ?? [], 'persisted attachments').length;
      if (message.attachmentStatus !== 'COMPLETED' || count !== expectedCount) throw new Error(`Attachment persistence ended as ${String(message.attachmentStatus)} with ${count}/${expectedCount} references.`);
      return elapsed(startedAt);
    }
    await Bun.sleep(pollIntervalMs);
  }
  throw new Error(`Attachments did not converge within ${persistenceTimeoutMs}ms.`);
}

async function runProvider(scenario: Scenario, iteration: number, provider: ReturnType<typeof createOpenRouterProvider>) {
  const startedAt = performance.now();
  let firstDeltaMs: number | null = null;
  let deltaCount = 0;
  let content = '';
  let done = false;
  try {
    if (!provider.stream) throw new Error('OpenRouter streaming is unavailable.');
    const parts: unknown[] = scenario.fixtures.map((fixture) => fixture.kind === 'image'
      ? { type: 'image' as const, mimeType: fixture.mimeType as 'image/png' | 'image/jpeg', bytes: fixture.bytes }
      : { type: 'file' as const, filename: fixture.filename, mimeType: 'text/plain' as const, bytes: fixture.bytes });
    parts.push({ type: 'text', text: scenario.prompt });
    for await (const chunk of provider.stream({
      actionId: 'text', modelId: 'google.gemini-3.1-flash-lite', externalModelId: 'google/gemini-3.1-flash-lite', teamKey,
      input: { systemPrompt: 'Follow the user request exactly. Inspect every supplied attachment directly. Do not use tools.', messages: [{ role: 'user', content: parts }], options: { temperature: 0, maxTokens: 128 } },
      timeoutMs: turnTimeoutMs,
    })) {
      if (chunk.type === 'text-delta') { if (firstDeltaMs === null) firstDeltaMs = elapsed(startedAt); content += chunk.text; deltaCount += 1; }
      if (chunk.type === 'done') done = true;
    }
    if (!done) throw Object.assign(new Error('Provider stream ended before completion.'), { prematureEof: true });
    const accurate = content.toUpperCase().includes(scenario.expected.toUpperCase());
    results.push({ scenario: scenario.name, iteration, path: 'provider', status: accurate ? 'passed' : 'failed', accurate, prematureEof: false, detail: accurate ? content.trim().slice(0, 160) : `Expected ${scenario.expected}, received ${content.trim().slice(0, 300)}`, metrics: { fixtureBytes: scenario.fixtures.reduce((sum, fixture) => sum + fixture.bytes.byteLength, 0), firstDeltaMs, totalMs: elapsed(startedAt), deltaCount } });
  } catch (error) {
    results.push({ scenario: scenario.name, iteration, path: 'provider', status: 'failed', accurate: false, prematureEof: Boolean((error as { prematureEof?: boolean })?.prematureEof), detail: error instanceof Error ? error.message : String(error), metrics: { fixtureBytes: scenario.fixtures.reduce((sum, fixture) => sum + fixture.bytes.byteLength, 0), firstDeltaMs, totalMs: elapsed(startedAt), deltaCount } });
  }
}

async function runCoreProvider(scenario: Scenario, iteration: number, provider: ReturnType<typeof createOpenRouterProvider>) {
  const startedAt = performance.now();
  let firstDeltaMs: number | null = null;
  let deltaCount = 0;
  let content = '';
  try {
    if (!provider.stream) throw new Error('OpenRouter streaming is unavailable.');
    const directTeamKey = newId(), directScopeKey = newId(), directUserKey = newId();
    const stream = async function* (requestTeamKey: string, input: Parameters<NonNullable<typeof provider.stream>>[0]['input'], options: ExecuteActionOptions = {}) {
      yield* provider.stream!({ actionId: 'text', modelId: 'google.gemini-3.1-flash-lite', externalModelId: 'google/gemini-3.1-flash-lite', teamKey: requestTeamKey, input, capabilities: options.capabilities, timeoutMs: options.timeoutMs, signal: options.signal });
    };
    const response = await executeCoreAgent({
      systemPrompt: coreAgent.systemPrompt, message: scenario.prompt, currentDate: new Date().toISOString(), requestKey: `attachment-eval-core-${scenario.name}-${iteration}-${suffix}`, generateName: false,
      attachments: scenario.fixtures.map((fixture) => fixture.kind === 'image' ? fixture : { kind: 'document' as const, filename: fixture.filename, mimeType: fixture.mimeType, bytes: fixture.bytes }),
    }, {
      toolContext: { teamKey: directTeamKey, runtimeScopeKey: directScopeKey, principal: { kind: 'member', user: { key: directUserKey }, userTeam: { key: newId(), teamKey: directTeamKey, userId: directUserKey, status: 'active' }, scopeMember: null } } as never,
      onDelta(delta) { if (firstDeltaMs === null) firstDeltaMs = elapsed(startedAt); content += delta; deltaCount += 1; },
    }, { stream: stream as never, tools: { execute: async () => { throw new Error('The attachment performance Core path must not invoke a tool.'); } } });
    const accurate = response.message.toUpperCase().includes(scenario.expected.toUpperCase()) && content === response.message;
    results.push({ scenario: scenario.name, iteration, path: 'core', status: accurate ? 'passed' : 'failed', accurate, prematureEof: false, detail: accurate ? response.message.trim().slice(0, 160) : `Expected ${scenario.expected}, received ${response.message.trim().slice(0, 300)}`, metrics: { fixtureBytes: scenario.fixtures.reduce((sum, fixture) => sum + fixture.bytes.byteLength, 0), firstDeltaMs, totalMs: elapsed(startedAt), deltaCount } });
  } catch (error) {
    results.push({ scenario: scenario.name, iteration, path: 'core', status: 'failed', accurate: false, prematureEof: Boolean((error as { prematureEof?: boolean })?.prematureEof), detail: error instanceof Error ? error.message : String(error), metrics: { fixtureBytes: scenario.fixtures.reduce((sum, fixture) => sum + fixture.bytes.byteLength, 0), firstDeltaMs, totalMs: elapsed(startedAt), deltaCount } });
  }
}

async function runPipeline(scenario: Scenario, iteration: number) {
  const overallStartedAt = performance.now();
  let measuredStartedAt = overallStartedAt;
  let partialMetrics: Partial<Metrics> = { fixtureBytes: scenario.fixtures.reduce((sum, fixture) => sum + fixture.bytes.byteLength, 0), firstDeltaMs: null, deltaCount: 0 };
  try {
    const conversationKey = await createConversation(`${scenario.name}-${iteration}`);
    if (!scenario.firstTurn) {
      const warmKey = `attachment-eval-warm-${scenario.name}-${iteration}-${suffix}`;
      const warm = await streamPipelineTurn(conversationKey, warmKey, `Reply with exactly WARM_${suffix}.`, []);
      if (!warm.content.toUpperCase().includes(`WARM_${suffix}`)) throw new Error('Conversation warm-up was inaccurate.');
    }
    measuredStartedAt = performance.now();
    const requestKey = `attachment-eval-${scenario.name}-${iteration}-${suffix}`;
    const uploaded = await uploadAttachments(conversationKey, requestKey, scenario.fixtures);
    partialMetrics = { ...partialMetrics, ...uploaded };
    const turn = await streamPipelineTurn(conversationKey, requestKey, scenario.prompt, uploaded.attachmentKeys);
    partialMetrics = {
      ...partialMetrics,
      sseOpenMs: turn.openedMs,
      sseStartMs: turn.startMs,
      firstDeltaMs: turn.firstDeltaMs,
      lastDeltaMs: turn.lastDeltaMs,
      doneMs: turn.doneMs,
      terminalTailMs: turn.firstDeltaMs === null || turn.doneMs === undefined ? null : turn.doneMs - turn.firstDeltaMs,
      postLastDeltaMs: turn.lastDeltaMs === null || turn.doneMs === undefined ? null : turn.doneMs - turn.lastDeltaMs,
      deltaCount: turn.deltaCount,
    };
    const persistenceMs = await waitForAttachments(conversationKey, turn.userMessageKey, scenario.fixtures.length);
    const accurate = turn.content.toUpperCase().includes(scenario.expected.toUpperCase());
    results.push({ scenario: scenario.name, iteration, path: 'pipeline', status: accurate ? 'passed' : 'failed', accurate, prematureEof: false, detail: accurate ? turn.content.trim().slice(0, 160) : `Expected ${scenario.expected}, received ${turn.content.trim().slice(0, 300)}`, metrics: { ...partialMetrics, fixtureBytes: partialMetrics.fixtureBytes!, firstDeltaMs: partialMetrics.firstDeltaMs ?? null, persistenceMs, totalMs: elapsed(measuredStartedAt), deltaCount: partialMetrics.deltaCount ?? 0 } });
  } catch (error) {
    results.push({ scenario: scenario.name, iteration, path: 'pipeline', status: 'failed', accurate: false, prematureEof: Boolean((error as { prematureEof?: boolean })?.prematureEof), detail: error instanceof Error ? error.message : String(error), metrics: { ...partialMetrics, fixtureBytes: partialMetrics.fixtureBytes!, firstDeltaMs: partialMetrics.firstDeltaMs ?? null, totalMs: elapsed(measuredStartedAt === overallStartedAt ? overallStartedAt : measuredStartedAt), deltaCount: partialMetrics.deltaCount ?? 0 } });
  }
}

function median(values: number[]) {
  if (!values.length) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle]! : Math.round((sorted[middle - 1]! + sorted[middle]!) / 2);
}

async function noisyImage(width: number, height: number, dominant: 'red' | 'blue') {
  const bytes = Buffer.allocUnsafe(width * height * 3);
  let state = dominant === 'red' ? 0x12345678 : 0x87654321;
  for (let index = 0; index < bytes.length; index += 3) {
    state ^= state << 13; state ^= state >>> 17; state ^= state << 5;
    const noise = state >>> 0;
    bytes[index] = dominant === 'red' ? 170 + noise % 86 : noise % 70;
    bytes[index + 1] = (noise >>> 8) % 80;
    bytes[index + 2] = dominant === 'blue' ? 170 + (noise >>> 16) % 86 : (noise >>> 16) % 70;
  }
  return new Uint8Array(await sharp(bytes, { raw: { width, height, channels: 3 } }).jpeg({ quality: 88 }).toBuffer());
}

async function fixturesAndScenarios() {
  const smallRed = new Uint8Array(await sharp({ create: { width: 96, height: 96, channels: 3, background: '#ff0000' } }).png().toBuffer());
  const smallBlue = new Uint8Array(await sharp({ create: { width: 96, height: 96, channels: 3, background: '#0000ff' } }).png().toBuffer());
  const largeRed = await noisyImage(1800, 1800, 'red');
  const largeBlue = await noisyImage(1800, 1800, 'blue');
  const documentA = new TextEncoder().encode(`The first document marker is DOC_A_${suffix}.`);
  const documentB = new TextEncoder().encode(`The second document marker is DOC_B_${suffix}.`);
  const image = (filename: string, mimeType: 'image/png' | 'image/jpeg', bytes: Uint8Array): Fixture => ({ kind: 'image', filename, mimeType, bytes });
  const file = (filename: string, bytes: Uint8Array): Fixture => ({ kind: 'file', filename, mimeType: 'text/plain', bytes });
  const exact = (expected: string, instruction: string) => `${instruction} Reply with exactly ${expected} and nothing else.`;
  return [
    { name: 'text-baseline', expected: `BASE_${suffix}`, prompt: exact(`BASE_${suffix}`, 'Do not use tools.'), fixtures: [] },
    { name: 'one-file', expected: `DOC_A_${suffix}`, prompt: exact(`DOC_A_${suffix}`, 'Read the attached file and return its marker.'), fixtures: [file('first.txt', documentA)] },
    { name: 'two-files', expected: `DOC_A_${suffix}|DOC_B_${suffix}`, prompt: exact(`DOC_A_${suffix}|DOC_B_${suffix}`, 'Read both attached files and return their markers in attachment order separated by a vertical bar.'), fixtures: [file('first.txt', documentA), file('second.txt', documentB)] },
    { name: 'one-small-image', expected: 'RED', prompt: exact('RED', 'Inspect the attached image and identify its dominant color.'), fixtures: [image('small-red.png', 'image/png', smallRed)] },
    { name: 'two-small-images', expected: 'RED|BLUE', prompt: exact('RED|BLUE', 'Inspect both images and return their dominant colors in attachment order separated by a vertical bar.'), fixtures: [image('small-red.png', 'image/png', smallRed), image('small-blue.png', 'image/png', smallBlue)] },
    { name: 'two-realistic-images', expected: 'RED|BLUE', prompt: exact('RED|BLUE', 'Inspect both large noisy images and return their dominant colors in attachment order separated by a vertical bar.'), fixtures: [image('large-red.jpg', 'image/jpeg', largeRed), image('large-blue.jpg', 'image/jpeg', largeBlue)] },
    { name: 'mixed-image-file', expected: `RED|DOC_A_${suffix}`, prompt: exact(`RED|DOC_A_${suffix}`, 'Inspect the image and file, then return the image dominant color and document marker separated by a vertical bar.'), fixtures: [image('large-red.jpg', 'image/jpeg', largeRed), file('first.txt', documentA)] },
    { name: 'first-turn-two-images', expected: 'RED|BLUE', prompt: exact('RED|BLUE', 'Inspect both large noisy images and return their dominant colors in attachment order separated by a vertical bar.'), fixtures: [image('large-red.jpg', 'image/jpeg', largeRed), image('large-blue.jpg', 'image/jpeg', largeBlue)], firstTurn: true },
  ] satisfies Scenario[];
}

try {
  if (!pipelineOnly && !process.env.OPENROUTER_API_KEY?.trim()) throw new Error('OPENROUTER_API_KEY is required for direct-provider evaluation.');
  if (!providerOnly && !coreOnly) {
    const health = await fetch(`${apiBase}/api/v1/health`);
    if (!health.ok) throw new Error(`Attachment evaluation health check failed with ${health.status}.`);
  }
  if (!providerOnly && !coreOnly) {
    const guestResponse = await fetch(`${apiBase}/api/v1/auth/guest`, {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-vorinthex-session-transport': 'header' },
      body: JSON.stringify({ distinctId: `app_core_attachment_eval_${suffix.toLowerCase()}`, bootstrapSecret: `guest_${crypto.randomUUID().replaceAll('-', '')}${crypto.randomUUID().replaceAll('-', '')}` }),
    });
    if (!guestResponse.ok) throw new Error(`Guest bootstrap failed with ${guestResponse.status}: ${await guestResponse.text()}`);
    accessToken = string(guestResponse.headers.get('x-access-token'), 'access token');
    refreshToken = string(guestResponse.headers.get('x-refresh-token'), 'refresh token');
    const guest = object(await guestResponse.json(), 'guest response');
    teamKey = string(object(guest.team, 'guest team').key, 'team key');
    scopeKey = string(object(guest.scope ?? guest.main_scope, 'guest scope').key, 'scope key');
  }

  const availableScenarios = await fixturesAndScenarios();
  const scenarios = scenarioName ? availableScenarios.filter(({ name }) => name === scenarioName) : availableScenarios;
  if (!scenarios.length) throw new Error(`Unknown scenario ${scenarioName}; expected one of ${availableScenarios.map(({ name }) => name).join(', ')}.`);
  const provider = !pipelineOnly ? createOpenRouterProvider({ apiKey: process.env.OPENROUTER_API_KEY!, ...(process.env.OPENROUTER_BASE_URL ? { baseUrl: process.env.OPENROUTER_BASE_URL } : {}), appUrl: 'https://vorinthex.com', appName: 'Vorinthex attachment evaluation' }) : undefined;
  for (let iteration = 1; iteration <= repeat; iteration += 1) {
    for (const scenario of scenarios) {
      const resultStart = results.length;
      if (provider && !coreOnly) await runProvider(scenario, iteration, provider);
      if (provider && coreOnly) await runCoreProvider(scenario, iteration, provider);
      if (!providerOnly && !coreOnly) await runPipeline(scenario, iteration);
      const latest = results.slice(resultStart);
      console.log(latest.map(({ path, status, metrics }) => `${scenario.name}/${path}: ${status}, first=${metrics.firstDeltaMs ?? 'n/a'}ms, total=${metrics.totalMs}ms`).join(' | '));
    }
  }

  console.table(results.map(({ scenario, iteration, path, status, accurate, prematureEof, metrics }) => ({
    scenario, iteration, path, status, accurate, prematureEof, bytes: metrics.fixtureBytes,
    presignMs: metrics.presignMs ?? '-', uploadMs: metrics.uploadMs ?? '-', canonicalMs: metrics.canonicalizationMs ?? '-',
    openMs: metrics.sseOpenMs ?? '-', startMs: metrics.sseStartMs ?? '-', firstDeltaMs: metrics.firstDeltaMs ?? '-', lastDeltaMs: metrics.lastDeltaMs ?? '-', doneMs: metrics.doneMs ?? '-',
    terminalTailMs: metrics.terminalTailMs ?? '-', postLastDeltaMs: metrics.postLastDeltaMs ?? '-', persistenceMs: metrics.persistenceMs ?? '-', totalMs: metrics.totalMs,
  })));
  if (!providerOnly && !pipelineOnly) {
    console.table(scenarios.map(({ name }) => {
      const providerRows = results.filter((result) => result.scenario === name && result.path === 'provider' && result.status === 'passed');
      const pipelineRows = results.filter((result) => result.scenario === name && result.path === 'pipeline' && result.status === 'passed');
      const providerFirstDeltaMs = median(providerRows.flatMap(({ metrics }) => metrics.firstDeltaMs === null ? [] : [metrics.firstDeltaMs]));
      const pipelineFirstDeltaMs = median(pipelineRows.flatMap(({ metrics }) => metrics.firstDeltaMs === null ? [] : [metrics.firstDeltaMs]));
      const pipelinePreparationMs = median(pipelineRows.map(({ metrics }) => (metrics.presignMs ?? 0) + (metrics.uploadMs ?? 0) + (metrics.canonicalizationMs ?? 0)));
      const endToFirstDeltaMs = pipelineFirstDeltaMs === null || pipelinePreparationMs === null ? null : pipelineFirstDeltaMs + pipelinePreparationMs;
      return {
        scenario: name,
        providerFirstDeltaMs: providerFirstDeltaMs ?? '-',
        pipelineFirstDeltaMs: pipelineFirstDeltaMs ?? '-',
        pipelinePreparationMs: pipelinePreparationMs ?? '-',
        endToFirstDeltaMs: endToFirstDeltaMs ?? '-',
        platformOverProviderMs: providerFirstDeltaMs === null || endToFirstDeltaMs === null ? '-' : endToFirstDeltaMs - providerFirstDeltaMs,
        terminalTailMs: median(pipelineRows.flatMap(({ metrics }) => metrics.terminalTailMs === null || metrics.terminalTailMs === undefined ? [] : [metrics.terminalTailMs])) ?? '-',
      };
    }));
  }
  const failures = results.filter(({ status }) => status === 'failed');
  const prematureEofs = results.filter(({ prematureEof }) => prematureEof);
  console.log(JSON.stringify({ repeat, providerOnly, coreOnly, pipelineOnly, passed: results.length - failures.length, failed: failures.length, prematureEofs: prematureEofs.length, results }, null, 2));
  if (failures.length) throw new Error(`Attachment evaluation failed ${failures.length}/${results.length} paths; premature EOFs: ${prematureEofs.length}.`);
} finally {
  for (const conversationKey of conversationKeys) {
    if (!accessToken) break;
    try { await requestJson(`/conversations/${conversationKey}`, { teamKey, scopeKey }, 'DELETE'); }
    catch (error) { console.error(`Attachment evaluation conversation cleanup failed for ${conversationKey}.`, error); }
  }
  if (accessToken) {
    try { await deleteAccount(); }
    catch (error) { console.error('Attachment evaluation account cleanup failed.', error); }
  }
}
