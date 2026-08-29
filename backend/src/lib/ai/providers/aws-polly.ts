import { PollyClient, SynthesizeSpeechCommand, type LanguageCode, type SynthesizeSpeechCommandOutput, type VoiceId } from '@aws-sdk/client-polly';
import { createCredentialChain, fromIni, fromLoginCredentials } from '@aws-sdk/credential-providers';
import { z } from 'zod';
import { speechInputSchema, speechOutputSchema, type SpeechInput, type SpeechOutput } from '@/lib/ai/actions/generate-speech';
import { ZERO_TOKEN_USAGE } from '@/lib/ai/shared/usage';
import { normalizeProviderError, ProviderError } from './errors';
import { resolveRequestSignal, type ProviderAdapter, type ProviderExecuteRequest, type ProviderExecuteResponse, type ProviderFactory } from './types';

export const awsPollyProviderConfigSchema = z.object({
  region: z.string().min(1),
  endpoint: z.string().url().optional(),
  profile: z.string().min(1).optional(),
}).strict();
export type AwsPollyProviderConfig = z.input<typeof awsPollyProviderConfigSchema>;

const PROVIDER_ID = 'aws-polly' as const;
const POLLY_BILLED_CHARACTER_LIMIT = 3_000;
const POLLY_TOTAL_CHARACTER_LIMIT = 6_000;
const POLLY_NEURAL_COST_PER_CHARACTER = 16 / 1_000_000;
const languageVoices: Record<string, { code: LanguageCode; voices: Record<SpeechInput['voice'], VoiceId> }> = {
  english: { code: 'en-US', voices: { alloy: 'Matthew', coral: 'Joanna', nova: 'Danielle', sage: 'Gregory' } },
  french: { code: 'fr-FR', voices: { alloy: 'Remi', coral: 'Lea', nova: 'Lea', sage: 'Remi' } },
  german: { code: 'de-DE', voices: { alloy: 'Daniel', coral: 'Vicki', nova: 'Vicki', sage: 'Daniel' } },
  italian: { code: 'it-IT', voices: { alloy: 'Adriano', coral: 'Bianca', nova: 'Bianca', sage: 'Adriano' } },
  japanese: { code: 'ja-JP', voices: { alloy: 'Takumi', coral: 'Kazuha', nova: 'Tomoko', sage: 'Takumi' } },
  korean: { code: 'ko-KR', voices: { alloy: 'Seoyeon', coral: 'Seoyeon', nova: 'Seoyeon', sage: 'Seoyeon' } },
  portuguese: { code: 'pt-BR', voices: { alloy: 'Thiago', coral: 'Vitoria', nova: 'Camila', sage: 'Thiago' } },
  spanish: { code: 'es-ES', voices: { alloy: 'Sergio', coral: 'Lucia', nova: 'Lucia', sage: 'Sergio' } },
  swedish: { code: 'sv-SE', voices: { alloy: 'Elin', coral: 'Elin', nova: 'Elin', sage: 'Elin' } },
};

function pollyVoice(language: string, voice: SpeechInput['voice']) {
  const normalized = language.trim().toLocaleLowerCase().replace(/[_-].*$/, '');
  const aliases: Record<string, string> = { en: 'english', fr: 'french', de: 'german', it: 'italian', ja: 'japanese', ko: 'korean', pt: 'portuguese', es: 'spanish', sv: 'swedish' };
  const selected = languageVoices[aliases[normalized] ?? normalized];
  if (!selected) throw new ProviderError(PROVIDER_ID, 'invalid_input', `Amazon Polly does not support audiobook narration in ${language}`);
  return { languageCode: selected.code, voiceId: selected.voices[voice] };
}

type PollyTransport = {
  send(command: SynthesizeSpeechCommand, options?: { abortSignal?: AbortSignal }): Promise<SynthesizeSpeechCommandOutput>;
};
const clients = new Map<string, PollyClient>();

function pollyClient(config: z.output<typeof awsPollyProviderConfigSchema>): PollyClient {
  const key = JSON.stringify(config);
  const existing = clients.get(key);
  if (existing) return existing;
  const client = new PollyClient({
    region: config.region,
    endpoint: config.endpoint ?? `https://polly.${config.region}.amazonaws.com`,
    ...(config.profile ? { credentials: createCredentialChain(fromLoginCredentials({ profile: config.profile }), fromIni({ profile: config.profile })) } : {}),
  });
  clients.set(key, client);
  return client;
}

function escapeSsml(text: string): string {
  return text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&apos;');
}

export function buildPollySpeechSsml(text: string, pace: number): string {
  return `<speak><prosody rate="${Math.round(pace * 100)}%">${escapeSsml(text)}</prosody></speak>`;
}

function fitsPollySpeechChunk(text: string, pace: number): boolean {
  return text.length <= POLLY_BILLED_CHARACTER_LIMIT && buildPollySpeechSsml(text, pace).length <= POLLY_TOTAL_CHARACTER_LIMIT;
}

export function splitPollySpeechText(text: string, pace: number): string[] {
  const chunks: string[] = [];
  let chunk = '';
  for (const segment of text.split(/(\s+)/)) {
    let remaining = segment;
    while (remaining) {
      const candidate = chunk + remaining;
      if (fitsPollySpeechChunk(candidate, pace)) {
        chunk = candidate;
        break;
      }
      if (chunk.trim()) {
        chunks.push(chunk.trim());
        chunk = '';
        continue;
      }
      let piece = '';
      let consumed = 0;
      for (const character of remaining) {
        if (!fitsPollySpeechChunk(piece + character, pace)) break;
        piece += character;
        consumed += character.length;
      }
      if (!piece) throw new ProviderError(PROVIDER_ID, 'invalid_input', 'Amazon Polly speech chunk limit is too small');
      chunks.push(piece);
      remaining = remaining.slice(consumed);
    }
  }
  if (chunk.trim()) chunks.push(chunk.trim());
  return chunks;
}

interface Mp3Frame {
  length: number;
  sampleRate: number;
  samples: number;
}

function readMp3Frame(buffer: Uint8Array, offset: number): Mp3Frame | undefined {
  if (offset + 4 > buffer.length) return undefined;
  const header = ((buffer[offset]! << 24) | (buffer[offset + 1]! << 16) | (buffer[offset + 2]! << 8) | buffer[offset + 3]!) >>> 0;
  if (((header & 0xffe00000) >>> 0) !== 0xffe00000) return undefined;
  const versionBits = (header >>> 19) & 0b11;
  const layerBits = (header >>> 17) & 0b11;
  const bitrateIndex = (header >>> 12) & 0b1111;
  const sampleRateIndex = (header >>> 10) & 0b11;
  if (versionBits === 0b01 || layerBits !== 0b01 || bitrateIndex === 0 || bitrateIndex === 0b1111 || sampleRateIndex === 0b11) return undefined;
  const mpeg1 = versionBits === 0b11;
  const bitrateTable = mpeg1
    ? [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320]
    : [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160];
  const sampleRates = [44_100, 48_000, 32_000];
  const divisor = versionBits === 0b10 ? 2 : versionBits === 0b00 ? 4 : 1;
  const sampleRate = sampleRates[sampleRateIndex]! / divisor;
  const bitrate = bitrateTable[bitrateIndex]! * 1_000;
  const padding = (header >>> 9) & 1;
  const length = Math.floor(((mpeg1 ? 144 : 72) * bitrate) / sampleRate) + padding;
  return length >= 4 ? { length, sampleRate, samples: mpeg1 ? 1_152 : 576 } : undefined;
}

export function extractPollyMp3Frames(audio: Uint8Array): { bytes: Uint8Array; durationSeconds: number } {
  const frames: Uint8Array[] = [];
  let durationSeconds = 0;
  let offset = 0;
  while (offset + 4 <= audio.length) {
    const frame = readMp3Frame(audio, offset);
    if (!frame || offset + frame.length > audio.length) {
      if (frames.length) break;
      offset += 1;
      continue;
    }
    frames.push(audio.subarray(offset, offset + frame.length));
    durationSeconds += frame.samples / frame.sampleRate;
    offset += frame.length;
  }
  if (!frames.length) throw new ProviderError(PROVIDER_ID, 'response_invalid', 'Amazon Polly returned invalid MP3 audio');
  return { bytes: Buffer.concat(frames), durationSeconds };
}

function normalizePollyError(error: unknown): ProviderError {
  const name = error instanceof Error ? error.name : '';
  if (['CredentialsProviderError', 'UnrecognizedClientException', 'InvalidSignatureException', 'AccessDeniedException'].includes(name)) {
    return new ProviderError(PROVIDER_ID, 'authentication_failed', 'Amazon Polly authentication failed', { cause: error });
  }
  if (['ThrottlingException', 'TooManyRequestsException'].includes(name)) {
    return new ProviderError(PROVIDER_ID, 'rate_limited', 'Amazon Polly rate limit exceeded', { cause: error });
  }
  if (['EngineNotSupportedException', 'InvalidSsmlException', 'LanguageNotSupportedException', 'TextLengthExceededException'].includes(name)) {
    return new ProviderError(PROVIDER_ID, 'invalid_input', 'Amazon Polly rejected the speech input', { cause: error });
  }
  return normalizeProviderError(PROVIDER_ID, error);
}

async function generateSpeech<TInput, TOutput>(client: PollyTransport, request: ProviderExecuteRequest<TInput>): Promise<ProviderExecuteResponse<TOutput>> {
  const input = speechInputSchema.parse(request.input);
  if (request.externalModelId !== 'neural') throw new ProviderError(PROVIDER_ID, 'invalid_input', 'Amazon Polly speech requires the neural engine');
  const { languageCode, voiceId } = pollyVoice(input.language, input.voice);
  const signal = resolveRequestSignal(request);
  const audioParts: Uint8Array[] = [];
  const responses: Array<{ requestCharacters?: number; contentType?: string }> = [];
  let durationSeconds = 0;
  let requestCharacters = 0;
  for (const text of splitPollySpeechText(input.text, input.pace)) {
    let raw: SynthesizeSpeechCommandOutput;
    try {
      raw = await client.send(new SynthesizeSpeechCommand({
        Engine: 'neural',
        LanguageCode: languageCode,
        OutputFormat: 'mp3',
        SampleRate: '24000',
        Text: buildPollySpeechSsml(text, input.pace),
        TextType: 'ssml',
        VoiceId: voiceId,
      }), { abortSignal: signal });
    } catch (error) {
      throw normalizePollyError(error);
    }
    if (!raw.AudioStream || raw.ContentType !== 'audio/mpeg') throw new ProviderError(PROVIDER_ID, 'response_invalid', 'Amazon Polly returned no MP3 audio');
    const parsed = extractPollyMp3Frames(await raw.AudioStream.transformToByteArray());
    audioParts.push(parsed.bytes);
    durationSeconds += parsed.durationSeconds;
    requestCharacters += raw.RequestCharacters ?? text.length;
    responses.push({ requestCharacters: raw.RequestCharacters, contentType: raw.ContentType });
  }
  const output: SpeechOutput = speechOutputSchema.parse({
    base64: Buffer.concat(audioParts).toString('base64'),
    mimeType: 'audio/mpeg',
    durationSeconds: Math.max(1, Math.ceil(durationSeconds)),
  });
  return {
    output: output as TOutput,
    usage: ZERO_TOKEN_USAGE,
    costUsd: requestCharacters * POLLY_NEURAL_COST_PER_CHARACTER,
    providerId: PROVIDER_ID,
    modelId: request.modelId,
    externalModelId: request.externalModelId,
    rawResponse: responses,
  };
}

export function createAwsPollyProvider(config: AwsPollyProviderConfig, transport?: PollyTransport): ProviderAdapter {
  const parsed = awsPollyProviderConfigSchema.parse(config);
  const client = transport ?? pollyClient(parsed);
  return {
    id: PROVIDER_ID,
    name: 'Amazon Polly',
    async execute<TInput, TOutput>(request: ProviderExecuteRequest<TInput>) {
      if (request.actionId !== 'generate-speech') throw new ProviderError(PROVIDER_ID, 'unsupported_action', `aws-polly does not implement action ${request.actionId}`);
      return generateSpeech<TInput, TOutput>(client, request);
    },
  };
}

export const awsPollyProviderFactory: ProviderFactory = {
  id: PROVIDER_ID,
  configSchema: awsPollyProviderConfigSchema,
  create(config) { return createAwsPollyProvider(awsPollyProviderConfigSchema.parse(config)); },
};
