import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import OpenAI from 'openai';
import { OpenAIRealtimeWebSocket } from 'openai/realtime/websocket';
import ffmpegPath from 'ffmpeg-static';

const ROOT = dirname(fileURLToPath(import.meta.url));
const PUBLIC_AUDIO_DIR = join(ROOT, '../../web/app/public/audio/entities');
const MODEL_ID = 'gpt-realtime-2';
const INSTRUCTIONS = 'Speak the supplied text verbatim in a warm, natural, professional voice. Use a calm conversational pace, preserve every word in order, pause naturally at punctuation, and do not add, omit, summarize, or repeat anything.';

const ORCHESTRATORS = [
  ['atlas-ceo', 'cedar'], ['metis-cio', 'cedar'], ['echo-cko', 'cedar'], ['matrix-cdo', 'cedar'],
  ['hermes-coo', 'cedar'], ['harmony-chro', 'marin'], ['phoenix-cgo', 'cedar'], ['iris-cco', 'marin'],
  ['orbit-cmo', 'marin'], ['apollo-cso', 'cedar'], ['athena-cpo', 'marin'], ['forge-cto', 'cedar'],
  ['aura-cxo', 'marin'], ['pillar-cqo', 'cedar'], ['helios-caio', 'cedar'], ['vulcan-cao', 'cedar'],
  ['ledger-cfo', 'cedar'], ['mercury-cro', 'cedar'], ['sentinel-ciso', 'cedar'], ['themis-clo', 'marin'],
] as const;

const apiKey = process.env.OPENAI_API_KEY;
if (!apiKey) throw new Error('OPENAI_API_KEY is required.');
if (!ffmpegPath) throw new Error('ffmpeg-static did not provide an executable path.');
const client = new OpenAI({ apiKey });

async function synthesize(input: string, voice: 'marin' | 'cedar'): Promise<{ pcm: Buffer; transcript: string }> {
  const realtime = await OpenAIRealtimeWebSocket.create(client, { model: MODEL_ID });
  const audioChunks: Buffer[] = [];
  let transcript = '';
  realtime.on('response.output_audio.delta', (event) => audioChunks.push(Buffer.from(event.delta, 'base64')));
  realtime.on('response.output_audio_transcript.done', (event) => { transcript = event.transcript; });
  try {
    await realtime.emitted('session.created');
    realtime.send({
      type: 'session.update',
      session: {
        type: 'realtime',
        model: MODEL_ID,
        output_modalities: ['audio'],
        audio: { output: { format: { type: 'audio/pcm', rate: 24000 }, voice } },
        instructions: INSTRUCTIONS,
      },
    });
    await realtime.emitted('session.updated');
    realtime.send({
      type: 'conversation.item.create',
      item: { type: 'message', role: 'user', content: [{ type: 'input_text', text: input }] },
    });
    realtime.send({ type: 'response.create', response: { output_modalities: ['audio'] } });
    const done = await realtime.emitted('response.done');
    if (done.response.status !== 'completed') throw new Error(`Realtime response ended with status ${done.response.status}`);
    if (audioChunks.length === 0) throw new Error('Realtime response contained no audio');
    return { pcm: Buffer.concat(audioChunks), transcript };
  } finally {
    realtime.close();
  }
}

async function encodeMp3(pcm: Buffer, rawPath: string, outputPath: string): Promise<void> {
  await writeFile(rawPath, pcm);
  const ffmpeg = spawn(ffmpegPath!, ['-y', '-f', 's16le', '-ar', '24000', '-ac', '1', '-i', rawPath, '-codec:a', 'libmp3lame', '-q:a', '2', outputPath]);
  let stderr = '';
  ffmpeg.stderr.on('data', (chunk) => { stderr += chunk; });
  const [code] = await once(ffmpeg, 'close') as [number];
  if (code !== 0) throw new Error(`ffmpeg failed: ${stderr}`);
}

async function generate(folder: string, voice: 'marin' | 'cedar'): Promise<void> {
  const directory = join(ROOT, folder);
  const input = (await readFile(join(directory, 'MESSAGE.md'), 'utf8')).trim();
  if (!input) throw new Error(`${folder}/MESSAGE.md is empty`);
  if (input.length > 4096) throw new Error(`${folder}/MESSAGE.md exceeds the 4096-character speech limit`);

  const result = await synthesize(input, voice);
  const expectedWords = input.normalize('NFKC').toLowerCase().match(/[a-z0-9]+(?:'[a-z0-9]+)*/g) ?? [];
  const spokenWords = result.transcript.normalize('NFKC').toLowerCase().match(/[a-z0-9]+(?:'[a-z0-9]+)*/g) ?? [];
  if (expectedWords.join(' ') !== spokenWords.join(' ')) {
    throw new Error(`${folder} transcript did not preserve every source word. Received: ${JSON.stringify(result.transcript)}`);
  }
  const rawPath = join(directory, '.message.raw');
  const outputPath = join(directory, 'message.mp3');
  await mkdir(PUBLIC_AUDIO_DIR, { recursive: true });
  try {
    await encodeMp3(result.pcm, rawPath, outputPath);
    const audio = await readFile(outputPath);
    await writeFile(join(PUBLIC_AUDIO_DIR, `orchestrator-${folder.replace(/-.+$/, '')}-message.mp3`), audio);
    console.log(`Generated ${folder}/message.mp3 with ${voice} (${(result.pcm.length / 48_000).toFixed(2)}s)`);
  } finally {
    await rm(rawPath, { force: true });
  }
}

const requested = new Set(process.argv.slice(2));
const targets = requested.size === 0 ? ORCHESTRATORS : ORCHESTRATORS.filter(([folder]) => requested.has(folder));
if (targets.length === 0) throw new Error(`No matching orchestrators. Valid folders: ${ORCHESTRATORS.map(([folder]) => folder).join(', ')}`);

for (const [folder, voice] of targets) await generate(folder, voice);
