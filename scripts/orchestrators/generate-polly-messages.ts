import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PollyClient, SynthesizeSpeechCommand } from '@aws-sdk/client-polly';

const ROOT = dirname(fileURLToPath(import.meta.url));
const REGION = process.env.POLLY_REGION ?? 'us-east-1';

// Polly's generative voices provide the closest static-TTS counterparts to
// the Nova 2 Sonic Matthew/Orion and Tiffany/Lyra personas.
const ORCHESTRATORS = [
  ['atlas-ceo', 'Matthew'], ['metis-cio', 'Matthew'], ['echo-cko', 'Matthew'], ['matrix-cdo', 'Matthew'],
  ['hermes-coo', 'Matthew'], ['harmony-chro', 'Tiffany'], ['phoenix-cgo', 'Matthew'], ['iris-cco', 'Tiffany'],
  ['orbit-cmo', 'Tiffany'], ['apollo-cso', 'Matthew'], ['athena-cpo', 'Tiffany'], ['forge-cto', 'Matthew'],
  ['aura-cxo', 'Tiffany'], ['pillar-cqo', 'Matthew'], ['helios-caio', 'Matthew'], ['vulcan-cao', 'Matthew'],
  ['ledger-cfo', 'Matthew'], ['mercury-cro', 'Matthew'], ['sentinel-ciso', 'Matthew'], ['themis-clo', 'Tiffany'],
] as const;

const accessKeyId = process.env.BEDROCK_AWS_ACCESS_KEY_ID;
const secretAccessKey = process.env.BEDROCK_AWS_SECRET_ACCESS_KEY;
if (!accessKeyId || !secretAccessKey) throw new Error('BEDROCK_AWS_ACCESS_KEY_ID and BEDROCK_AWS_SECRET_ACCESS_KEY are required.');

const client = new PollyClient({
  region: REGION,
  credentials: { accessKeyId, secretAccessKey, sessionToken: process.env.BEDROCK_AWS_SESSION_TOKEN },
  endpoint: `https://polly.${REGION}.amazonaws.com`,
});

async function generate(folder: string, voiceId: 'Matthew' | 'Tiffany'): Promise<void> {
  const directory = join(ROOT, folder);
  const text = (await readFile(join(directory, 'MESSAGE.md'), 'utf8')).trim();
  if (!text) throw new Error(`${folder}/MESSAGE.md is empty`);

  const response = await client.send(new SynthesizeSpeechCommand({
    Engine: 'generative',
    OutputFormat: 'mp3',
    SampleRate: '24000',
    Text: text,
    TextType: 'text',
    VoiceId: voiceId,
  }));
  if (!response.AudioStream) throw new Error(`Polly returned no audio for ${folder}`);
  await writeFile(join(directory, 'message.mp3'), await response.AudioStream.transformToByteArray());
  console.log(`Generated ${folder}/message.mp3 with ${voiceId}`);
}

const requested = new Set(process.argv.slice(2));
const targets = requested.size === 0 ? ORCHESTRATORS : ORCHESTRATORS.filter(([folder]) => requested.has(folder));
if (targets.length === 0) throw new Error(`No matching orchestrators. Valid folders: ${ORCHESTRATORS.map(([folder]) => folder).join(', ')}`);

for (const [folder, voiceId] of targets) await generate(folder, voiceId);
