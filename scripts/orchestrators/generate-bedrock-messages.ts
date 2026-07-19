import { readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { BedrockRuntimeClient, InvokeModelWithBidirectionalStreamCommand } from '@aws-sdk/client-bedrock-runtime';
import { NodeHttp2Handler } from '@smithy/node-http-handler';
import ffmpegPath from 'ffmpeg-static';

const ROOT = dirname(fileURLToPath(import.meta.url));
const REGION = process.env.BEDROCK_REGION;
const MODEL_ID = 'amazon.nova-2-sonic-v1:0';

const ORCHESTRATORS = [
  ['atlas-ceo', 'matthew'], ['metis-cio', 'matthew'], ['echo-cko', 'matthew'], ['matrix-cdo', 'matthew'],
  ['hermes-coo', 'matthew'], ['harmony-chro', 'tiffany'], ['phoenix-cgo', 'matthew'], ['iris-cco', 'tiffany'],
  ['orbit-cmo', 'tiffany'], ['apollo-cso', 'matthew'], ['athena-cpo', 'tiffany'], ['forge-cto', 'matthew'],
  ['aura-cxo', 'tiffany'], ['pillar-cqo', 'matthew'], ['helios-caio', 'matthew'], ['vulcan-cao', 'matthew'],
  ['ledger-cfo', 'matthew'], ['mercury-cro', 'matthew'], ['sentinel-ciso', 'matthew'], ['themis-clo', 'tiffany'],
] as const;

if (!REGION) throw new Error('BEDROCK_REGION is required.');
if (!ffmpegPath) throw new Error('ffmpeg-static did not provide an executable path.');

const accessKeyId = process.env.BEDROCK_AWS_ACCESS_KEY_ID;
const secretAccessKey = process.env.BEDROCK_AWS_SECRET_ACCESS_KEY;
if (!accessKeyId || !secretAccessKey) throw new Error('BEDROCK_AWS_ACCESS_KEY_ID and BEDROCK_AWS_SECRET_ACCESS_KEY are required.');

const client = new BedrockRuntimeClient({
  region: REGION,
  credentials: { accessKeyId, secretAccessKey, sessionToken: process.env.BEDROCK_AWS_SESSION_TOKEN },
  endpoint: `https://bedrock-runtime.${REGION}.amazonaws.com`,
  requestHandler: new NodeHttp2Handler({ requestTimeout: 300_000, sessionTimeout: 300_000 }),
});

type SonicEvent = { event: Record<string, unknown> };
type SonicResponse = { audioChunks: Buffer[]; transcript: string; eventTypes: Set<string> };

function splitIntoSentences(message: string): string[] {
  const sentences = Array.from(
    new Intl.Segmenter('en', { granularity: 'sentence' }).segment(message),
    ({ segment }) => segment,
  );
  const segments: string[] = [];
  for (const sentence of sentences) {
    if (/\S/.test(sentence)) segments.push(sentence);
  }
  return segments;
}

function normalizeTranscript(text: string): string {
  return text
    .normalize('NFKC')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2010-\u2015]/g, '-')
    .replace(/\u2026/g, '...')
    .replace(/\s+/g, ' ')
    .replace(/\s+([,.;:!?])/g, '$1')
    .trim()
    .toLowerCase();
}

function sonicSession(message: string, voiceId: string): { body: AsyncIterable<unknown>; start: () => void; stopKeepalive: () => void; close: () => void } {
  const promptName = randomUUID();
  const systemContentName = randomUUID();
  const audioContentName = randomUUID();
  const contentName = randomUUID();
  const initialEvents: SonicEvent[] = [
    { event: { sessionStart: { inferenceConfiguration: { maxTokens: 4096, topP: 0.9, temperature: 0 } } } },
    { event: { promptStart: {
      promptName,
      textOutputConfiguration: { mediaType: 'text/plain' },
      audioOutputConfiguration: { audioType: 'SPEECH', encoding: 'base64', mediaType: 'audio/lpcm', sampleRateHertz: 24000, sampleSizeBits: 16, channelCount: 1, voiceId },
    } } },
    { event: { contentStart: { promptName, contentName: systemContentName, type: 'TEXT', interactive: false, role: 'SYSTEM', textInputConfiguration: { mediaType: 'text/plain' } } } },
    { event: { textInput: { promptName, contentName: systemContentName, content: 'You are a text-to-speech narrator. Speak the complete user script verbatim, from its first word through its final word. Your entire response must be only that script. Do not summarize, shorten, explain, greet, add commentary, or omit any sentence.' } } },
    { event: { contentEnd: { promptName, contentName: systemContentName } } },
    { event: { contentStart: { promptName, contentName: audioContentName, type: 'AUDIO', interactive: true, role: 'USER', audioInputConfiguration: { audioType: 'SPEECH', encoding: 'base64', mediaType: 'audio/lpcm', sampleRateHertz: 16000, sampleSizeBits: 16, channelCount: 1 } } } },
    { event: { contentStart: { promptName, contentName, type: 'TEXT', interactive: true, role: 'USER', textInputConfiguration: { mediaType: 'text/plain' } } } },
    { event: { textInput: { promptName, contentName, content: message } } },
    { event: { contentEnd: { promptName, contentName } } },
  ];
  const queue: SonicEvent[] = [];
  let closed = false;
  let wake: (() => void) | undefined;
  let silenceTimer: ReturnType<typeof setInterval> | undefined;
  const silence = Buffer.alloc(1_600).toString('base64'); // 50 ms of 16 kHz mono s16le silence.

  const enqueueSilence = () => {
    if (closed) return;
    queue.push({ event: { audioInput: { promptName, contentName: audioContentName, content: silence } } });
    wake?.();
  };
  const stopKeepalive = () => {
    clearInterval(silenceTimer);
    silenceTimer = undefined;
  };

  return {
    body: {
      async *[Symbol.asyncIterator]() {
        while (!closed || queue.length > 0) {
          const event = queue.shift();
          if (event) {
            yield { chunk: { bytes: new TextEncoder().encode(JSON.stringify(event)) } };
            continue;
          }
          await new Promise<void>((resolve) => { wake = resolve; });
          wake = undefined;
        }
      },
    },
    start: () => {
      queue.push(...initialEvents);
      wake?.();
      enqueueSilence();
      silenceTimer = setInterval(enqueueSilence, 50);
    },
    stopKeepalive,
    close: () => {
      if (closed) return;
      stopKeepalive();
      queue.push(
        { event: { contentEnd: { promptName, contentName: audioContentName } } },
        { event: { promptEnd: { promptName } } },
        { event: { sessionEnd: {} } },
      );
      closed = true;
      wake?.();
    },
  };
}

async function encodeMp3(rawPath: string, outputPath: string): Promise<void> {
  const ffmpeg = spawn(ffmpegPath, ['-y', '-f', 's16le', '-ar', '24000', '-ac', '1', '-i', rawPath, '-codec:a', 'libmp3lame', '-q:a', '2', outputPath]);
  let stderr = '';
  ffmpeg.stderr.on('data', (chunk) => { stderr += chunk; });
  const [code] = await once(ffmpeg, 'close') as [number];
  if (code !== 0) throw new Error(`ffmpeg failed: ${stderr}`);
}

async function generateSegment(message: string, voiceId: string): Promise<SonicResponse> {
  const audioChunks: Buffer[] = [];
  const eventTypes = new Set<string>();
  const textChunks: string[] = [];
  const stream = sonicSession(message, voiceId);
  // Keep the input iterator open in the background before sending Sonic's text turn.
  const responsePromise = client.send(new InvokeModelWithBidirectionalStreamCommand({ modelId: MODEL_ID, body: stream.body as never }));
  stream.start();
  const response = await responsePromise;
  for await (const item of response.body ?? []) {
    const bytes = item.chunk?.bytes;
    if (!bytes) continue;
    const payload = JSON.parse(new TextDecoder().decode(bytes)) as { event?: { contentStart?: { type?: string }; audioOutput?: { content?: string }; textOutput?: { content?: string }; contentEnd?: { type?: string } } };
    for (const eventType of Object.keys(payload.event ?? {})) eventTypes.add(eventType);
    const content = payload.event?.audioOutput?.content;
    if (content) audioChunks.push(Buffer.from(content, 'base64'));
    if (payload.event?.textOutput?.content) textChunks.push(payload.event.textOutput.content);
    if (payload.event?.contentStart?.type === 'AUDIO') stream.stopKeepalive();
    if (payload.event?.contentEnd?.type === 'AUDIO') stream.close();
  }
  return { audioChunks, transcript: textChunks.join(''), eventTypes };
}

async function generate(folder: string, voiceId: string): Promise<void> {
  const directory = join(ROOT, folder);
  const message = await readFile(join(directory, 'MESSAGE.md'), 'utf8');
  const segments = splitIntoSentences(message);
  if (segments.length === 0) throw new Error(`${folder}/MESSAGE.md is empty`);

  const audioChunks: Buffer[] = [];
  for (const [index, segment] of segments.entries()) {
    const response = await generateSegment(segment, voiceId);
    if (response.audioChunks.length === 0) {
      throw new Error(`${folder} segment ${index + 1}/${segments.length} returned no audio (${[...response.eventTypes].join(', ') || 'no events'}). Confirm Nova Sonic model access and voice availability in ${REGION}.`);
    }
    if (!normalizeTranscript(response.transcript).startsWith(normalizeTranscript(segment))) {
      throw new Error(`${folder} segment ${index + 1}/${segments.length} transcript mismatch. Expected: ${JSON.stringify(segment)}. Received: ${JSON.stringify(response.transcript)}`);
    }
    audioChunks.push(...response.audioChunks);
    console.log(`${folder} segment ${index + 1}/${segments.length} transcript validated`);
  }

  const rawPath = join(directory, '.message.raw');
  const outputPath = join(directory, 'message.mp3');
  await writeFile(rawPath, Buffer.concat(audioChunks));
  try {
    await encodeMp3(rawPath, outputPath);
  } finally {
    await rm(rawPath, { force: true });
  }
  console.log(`Generated ${outputPath} (${(Buffer.concat(audioChunks).byteLength / 48_000).toFixed(2)}s)`);
}

const requested = new Set(process.argv.slice(2));
const targets = requested.size === 0 ? ORCHESTRATORS : ORCHESTRATORS.filter(([folder]) => requested.has(folder));
if (targets.length === 0) throw new Error(`No matching orchestrators. Valid folders: ${ORCHESTRATORS.map(([folder]) => folder).join(', ')}`);

for (const [folder, voiceId] of targets) await generate(folder, voiceId);
