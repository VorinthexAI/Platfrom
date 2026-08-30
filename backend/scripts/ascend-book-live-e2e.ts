export {};

const apiBase = (process.env.ASCEND_E2E_API_URL ?? 'http://127.0.0.1:3001').replace(/\/$/, '');
const hostname = new URL(apiBase).hostname;
if (!['localhost', '127.0.0.1', '::1'].includes(hostname) && process.env.ASCEND_E2E_DANGEROUS_REMOTE !== 'true') {
  throw new Error(`Refusing Ascend E2E against non-local host ${hostname}; set ASCEND_E2E_DANGEROUS_REMOTE=true to override.`);
}

function object(value: unknown, label = 'response'): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`Expected ${label} to be an object.`);
  return value as Record<string, unknown>;
}

function string(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value) throw new Error(`Missing ${label}.`);
  return value;
}

function number(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) throw new Error(`Missing positive ${label}.`);
  return value;
}

const suffix = crypto.randomUUID().replaceAll('-', '');
const guestResponse = await fetch(`${apiBase}/api/v1/auth/guest`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', 'x-vorinthex-session-transport': 'header' },
  body: JSON.stringify({
    distinctId: `app_ascend_book_e2e_${suffix}`,
    bootstrapSecret: `guest_${crypto.randomUUID().replaceAll('-', '')}${crypto.randomUUID().replaceAll('-', '')}`,
  }),
});
if (!guestResponse.ok) throw new Error(`Guest bootstrap failed with ${guestResponse.status}: ${await guestResponse.text()}`);
const guest = object(await guestResponse.json(), 'guest response');
const organizationKey = string(object(guest.organization, 'guest organization').key, 'organization key');
const scopeKey = string(object(guest.main_scope, 'guest main scope').key, 'scope key');
let accessToken = string(guestResponse.headers.get('x-access-token'), 'access token');
let refreshToken = string(guestResponse.headers.get('x-refresh-token'), 'refresh token');

async function api(path: string, body: Record<string, unknown>, method = 'POST') {
  const response = await fetch(`${apiBase}/api/v1${path}`, {
    method,
    headers: {
      authorization: `Bearer ${accessToken}`,
      'content-type': 'application/json',
      'x-refresh-token': refreshToken,
      'x-vorinthex-api-key': process.env.API_KEY ?? '',
      'x-vorinthex-session-transport': 'header',
    },
    body: JSON.stringify(body),
  });
  accessToken = response.headers.get('x-access-token') ?? accessToken;
  refreshToken = response.headers.get('x-refresh-token') ?? refreshToken;
  const payload = object(await response.json(), `${path} response`);
  if (!response.ok || payload.success !== true) throw new Error(`${method} ${path} failed with ${response.status}: ${JSON.stringify(payload)}`);
  return object(payload.data, `${path} data`);
}

const generationStartedAt = performance.now();
const created = await api('/books', {
  organizationKey,
  scopeKey,
  generationRequestKey: `ascend-book-e2e-${suffix}`,
  topic: 'Maintaining a reliable everyday bicycle at home',
  goal: 'Create a practical introduction to bicycle inspection, cleaning, lubrication, tire care, brake adjustment, drivetrain care, and preventive maintenance.',
  currentKnowledge: 'The reader rides a bicycle regularly but is new to bicycle maintenance and owns only basic hand tools.',
  writingTone: 'Clear, practical, technically accurate, and encouraging',
  language: 'English',
  archiveDocumentKeys: [],
  narratorVoiceKey: 'clear',
  narrationPace: 1,
  additionalInstructions: 'Use concrete examples and end each chapter with a concise practical takeaway.',
});
const acceptedAt = performance.now();
const bookKey = string(created.key, 'book key');
console.log(`Ascend accepted 10-chapter book ${bookKey}.`);

const timeoutMs = Number(process.env.ASCEND_E2E_TIMEOUT_MS ?? 45 * 60_000);
const deadline = Date.now() + timeoutMs;
let lastProgress = '';
let detail: Record<string, unknown> | undefined;
while (Date.now() < deadline) {
  detail = await api(`/books/${bookKey}/detail`, { organizationKey, scopeKey });
  const book = object(detail.book, 'book');
  const status = string(book.status, 'book status');
  const progress = `${status}:${String(book.generationProgressPercent ?? 100)}`;
  if (progress !== lastProgress) {
    console.log(`Ascend generation ${status} (${String(book.generationProgressPercent ?? 100)}%).`);
    lastProgress = progress;
  }
  if (status === 'failed' || status === 'cancelled') throw new Error(`Ascend generation ${status}: ${String(book.failureMessage ?? 'no failure detail')}`);
  if (status === 'ready') break;
  await Bun.sleep(250);
}
if (!detail || object(detail.book, 'book').status !== 'ready') throw new Error(`Ascend book ${bookKey} did not finish within ${timeoutMs}ms.`);
const readyAt = performance.now();

const book = object(detail.book, 'book');
const chapters = detail.chapters;
if (!Array.isArray(chapters) || chapters.length !== 10) throw new Error(`Expected 10 chapters, received ${Array.isArray(chapters) ? chapters.length : 'invalid data'}.`);
if (book.chapterCount !== 10) throw new Error(`Book reported unexpected chapter count ${String(book.chapterCount)}.`);
const coverUrl = string(book.coverUrl, 'cover URL');
const coverResponse = await fetch(coverUrl);
if (!coverResponse.ok || !(coverResponse.headers.get('content-type') ?? '').startsWith('image/')) throw new Error('Generated cover could not be downloaded as an image.');

let totalAudioSeconds = 0;
let totalAudioBytes = 0;
for (const [index, value] of chapters.entries()) {
  const chapter = object(value, `chapter ${index + 1}`);
  if (chapter.position !== index + 1) throw new Error(`Chapter ${index + 1} has position ${String(chapter.position)}.`);
  string(chapter.title, `chapter ${index + 1} title`);
  string(chapter.content, `chapter ${index + 1} content`);
  totalAudioSeconds += number(chapter.audioDurationSeconds, `chapter ${index + 1} audio duration`);
  const audioResponse = await fetch(string(chapter.audioUrl, `chapter ${index + 1} audio URL`));
  const audio = new Uint8Array(await audioResponse.arrayBuffer());
  if (!audioResponse.ok || audioResponse.headers.get('content-type') !== 'audio/mpeg' || audio.length < 4 || audio[0] !== 0xff) throw new Error(`Chapter ${index + 1} did not download as a valid MP3.`);
  totalAudioBytes += audio.length;
}

console.log(JSON.stringify({ bookKey, title: book.title, chapters: chapters.length, acceptanceMs: Math.round(acceptedAt - generationStartedAt), readyMs: Math.round(readyAt - generationStartedAt), generationAfterAcceptanceMs: Math.round(readyAt - acceptedAt), totalAudioSeconds, totalAudioBytes, coverBytes: Number(coverResponse.headers.get('content-length') ?? 0) }, null, 2));
console.log('Ascend 10-chapter live E2E passed.');
