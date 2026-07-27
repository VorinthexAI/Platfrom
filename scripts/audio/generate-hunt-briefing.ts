import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import OpenAI from 'openai';
import { OpenAIRealtimeWebSocket } from 'openai/realtime/websocket';
import ffmpegPath from 'ffmpeg-static';

const ROOT = dirname(fileURLToPath(import.meta.url));
const SOURCE = join(ROOT, 'hunt-briefing.md');
const OUTPUT = join(ROOT, '../../web/app/public/audio/brand/hunt-briefing.mp3');
const RUN_ID = `${process.pid}-${Date.now()}`;
const RAW_TEMP = `${OUTPUT}.${RUN_ID}.raw.tmp`;
const MP3_TEMP = `${OUTPUT}.${RUN_ID}.tmp.mp3`;
const MODEL = 'gpt-realtime-2';
const VOICE = 'ash';
const INSTRUCTIONS = 'Speak the supplied text verbatim in a confident, warm, natural male voice. Use a measured cinematic pace, preserve every word in order, pause naturally at punctuation, and do not add, omit, summarize, or repeat anything.';

const apiKey = process.env.OPENAI_API_KEY;
if (!apiKey) throw new Error('OPENAI_API_KEY is required.');
if (!ffmpegPath) throw new Error('ffmpeg-static did not provide an executable path.');

function words(value: string): string {
  return (value.normalize('NFKC').toLowerCase().match(/[a-z0-9]+(?:'[a-z0-9]+)*/g) ?? []).join(' ');
}

const input = (await readFile(SOURCE, 'utf8')).trim();
if (!input || input.length > 4_096) throw new Error('Hunt briefing must contain between 1 and 4096 characters.');
const realtime = await OpenAIRealtimeWebSocket.create(new OpenAI({ apiKey }), { model: MODEL });
const chunks: Buffer[] = [];
let transcript = '';
realtime.on('response.output_audio.delta', (event) => chunks.push(Buffer.from(event.delta, 'base64')));
realtime.on('response.output_audio_transcript.done', (event) => { transcript = event.transcript; });

try {
  await realtime.emitted('session.created');
  realtime.send({ type: 'session.update', session: { type: 'realtime', model: MODEL, output_modalities: ['audio'], audio: { output: { format: { type: 'audio/pcm', rate: 24_000 }, voice: VOICE } }, instructions: INSTRUCTIONS } });
  await realtime.emitted('session.updated');
  realtime.send({ type: 'conversation.item.create', item: { type: 'message', role: 'user', content: [{ type: 'input_text', text: input }] } });
  realtime.send({ type: 'response.create', response: { output_modalities: ['audio'] } });
  const done = await realtime.emitted('response.done');
  if (done.response.status !== 'completed' || chunks.length === 0) throw new Error(`Realtime response ended with status ${done.response.status ?? 'unknown'}`);
  if (words(input) !== words(transcript)) throw new Error(`Realtime transcript did not preserve the source. Received: ${JSON.stringify(transcript)}`);

  const pcm = Buffer.concat(chunks);
  await writeFile(RAW_TEMP, pcm);
  const ffmpeg = spawn(ffmpegPath, ['-y', '-f', 's16le', '-ar', '24000', '-ac', '1', '-i', RAW_TEMP, '-codec:a', 'libmp3lame', '-q:a', '2', MP3_TEMP]);
  let stderr = '';
  ffmpeg.stderr.on('data', (chunk) => { stderr += chunk; });
  const [code] = await once(ffmpeg, 'close') as [number];
  if (code !== 0) throw new Error(`ffmpeg failed: ${stderr}`);
  await rename(MP3_TEMP, OUTPUT);
  console.log(`Published Hunt briefing with ${MODEL}/${VOICE} (${(pcm.length / 48_000).toFixed(2)}s)`);
} finally {
  realtime.close();
  await rm(RAW_TEMP, { force: true });
  await rm(MP3_TEMP, { force: true });
}
