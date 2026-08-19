import OpenAI from 'openai';
import { OpenAIRealtimeWebSocket } from 'openai/realtime/websocket';
import { z } from 'zod';
import { tokenUsage } from '@/lib/ai/shared/usage';
import { normalizeProviderError, ProviderError } from './errors';
import {
  CHAT_ACTION_IDS,
  executeOpenAICompatibleChat,
  streamOpenAICompatibleChat,
  unsupportedAction,
} from './openai-compatible';
import {
  imageGenerateInputSchema,
  chatInputSchema,
  resolveRequestSignal,
  speechInputSchema,
  type ImageOutput,
  type ChatOutput,
  type ProviderAdapter,
  type ProviderExecuteRequest,
  type ProviderExecuteResponse,
  type ProviderFactory,
  type SpeechOutput,
  type ProviderStreamChunk,
} from './types';

export const openAIProviderConfigSchema = z
  .object({
    apiKey: z.string().min(1),
    baseUrl: z.string().url().optional(),
    organization: z.string().optional(),
    project: z.string().optional(),
  })
  .strict();

export type OpenAIProviderConfig = z.infer<typeof openAIProviderConfigSchema>;
export const openAICredentialsSchema = openAIProviderConfigSchema;
export type OpenAICredentials = OpenAIProviderConfig;

const PROVIDER_ID = 'openai' as const;
export const OPENAI_REALTIME_MODEL = 'gpt-realtime-2';

function realtimeUsage(usage: { input_tokens?: number; output_tokens?: number; total_tokens?: number } | undefined) {
  return tokenUsage(usage?.input_tokens, usage?.output_tokens, usage?.total_tokens);
}

function pcmToWav(pcm: Buffer): Buffer {
  const header = Buffer.alloc(44);
  header.write('RIFF', 0); header.writeUInt32LE(36 + pcm.length, 4); header.write('WAVE', 8);
  header.write('fmt ', 12); header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22); header.writeUInt32LE(24_000, 24); header.writeUInt32LE(48_000, 28);
  header.writeUInt16LE(2, 32); header.writeUInt16LE(16, 34); header.write('data', 36); header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

function assertRealtimeModel(request: ProviderExecuteRequest<unknown>): void {
  if (request.externalModelId !== OPENAI_REALTIME_MODEL) throw new ProviderError(PROVIDER_ID, 'unsupported_action', `OpenAI Realtime actions require ${OPENAI_REALTIME_MODEL}`);
}

function realtimeSignal(request: ProviderExecuteRequest<unknown>, realtime: OpenAIRealtimeWebSocket): { signal?: AbortSignal; remove: () => void } {
  const signal = resolveRequestSignal(request);
  const abort = () => realtime.close({ code: 1000, reason: 'request aborted' });
  signal?.addEventListener('abort', abort, { once: true });
  if (signal?.aborted) abort();
  return { signal, remove: () => signal?.removeEventListener('abort', abort) };
}

async function raceAbort<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise;
  if (signal.aborted) throw signal.reason ?? new DOMException('Request aborted', 'AbortError');
  let removeAbort = () => {};
  const aborted = new Promise<never>((_resolve, reject) => {
    const abort = () => reject(signal.reason ?? new DOMException('Request aborted', 'AbortError'));
    signal.addEventListener('abort', abort, { once: true });
    removeAbort = () => signal.removeEventListener('abort', abort);
  });
  try { return await Promise.race([promise, aborted]); }
  finally { removeAbort(); }
}

async function executeRealtimeChat<TInput, TOutput>(client: OpenAI, request: ProviderExecuteRequest<TInput>): Promise<ProviderExecuteResponse<TOutput>> {
  let text = '';
  let usage = tokenUsage(0, 0, 0);
  for await (const chunk of streamRealtimeChat(client, request)) {
    if (chunk.type === 'text-delta') text += chunk.text;
    else if (chunk.type === 'usage') usage = chunk.usage;
  }
  const output: ChatOutput = { text, toolCalls: [], stopReason: 'completed' };
  return { output: output as TOutput, usage, providerId: PROVIDER_ID, modelId: request.modelId, externalModelId: request.externalModelId };
}

async function* streamRealtimeChat<TInput>(client: OpenAI, request: ProviderExecuteRequest<TInput>): AsyncIterable<ProviderStreamChunk> {
  assertRealtimeModel(request);
  const input = chatInputSchema.parse(request.input);
  if (input.tools?.length || input.messages.some((message) => message.content.some((part) => part.type !== 'text'))) {
    throw new ProviderError(PROVIDER_ID, 'unsupported_action', 'OpenAI Realtime chat currently supports text messages without tools');
  }
  const realtime = await OpenAIRealtimeWebSocket.create(client, { model: OPENAI_REALTIME_MODEL });
  const realtimeRequest = realtimeSignal(request, realtime);
  const deltas: string[] = [];
  let wake: (() => void) | undefined;
  let completed: Awaited<ReturnType<typeof realtime.emitted<'response.done'>>> | undefined;
  let failure: Error | undefined;
  realtime.on('response.output_text.delta', (event) => { deltas.push(event.delta); wake?.(); });
  realtime.on('response.done', (event) => { completed = event; wake?.(); });
  realtime.on('error', (error) => { failure = error; wake?.(); });
  try {
    await raceAbort(realtime.emitted('session.created'), realtimeRequest.signal);
    realtime.send({ type: 'session.update', session: { type: 'realtime', model: OPENAI_REALTIME_MODEL, output_modalities: ['text'], instructions: input.systemPrompt, max_output_tokens: input.options?.maxTokens ?? 1_200 } });
    await raceAbort(realtime.emitted('session.updated'), realtimeRequest.signal);
    const transcript = input.messages.map((message) => `${message.role.toUpperCase()}: ${message.content.map((part) => part.type === 'text' ? part.text : '').join('\n')}`).join('\n\n');
    realtime.send({ type: 'conversation.item.create', item: { type: 'message', role: 'user', content: [{ type: 'input_text', text: transcript }] } });
    realtime.send({ type: 'response.create', response: { output_modalities: ['text'] } });
    while (!completed && !failure) {
      while (deltas.length) yield { type: 'text-delta', text: deltas.shift()! };
      if (!completed && !failure) await raceAbort(new Promise<void>((resolve) => { wake = resolve; }), realtimeRequest.signal);
      wake = undefined;
    }
    while (deltas.length) yield { type: 'text-delta', text: deltas.shift()! };
    if (failure) throw failure;
    if (completed?.response.status !== 'completed') throw new ProviderError(PROVIDER_ID, 'response_invalid', `Realtime response ended with status ${completed?.response.status ?? 'unknown'}`);
    yield { type: 'usage', usage: realtimeUsage(completed.response.usage) };
    yield { type: 'done' };
  } finally {
    realtimeRequest.remove();
    realtime.close();
  }
}

const imageResponseSchema = z.object({
  data: z
    .array(z.object({ b64_json: z.string().optional() }).passthrough())
    .optional(),
  usage: z
    .object({
      input_tokens: z.number().optional(),
      output_tokens: z.number().optional(),
      total_tokens: z.number().optional(),
    })
    .passthrough()
    .optional(),
});

async function executeImageGenerate<TInput, TOutput>(
  client: OpenAI,
  request: ProviderExecuteRequest<TInput>,
): Promise<ProviderExecuteResponse<TOutput>> {
  const input = imageGenerateInputSchema.parse(request.input);
  const raw = await client.images.generate(
    {
      model: request.externalModelId,
      prompt: input.prompt,
      n: input.count,
      ...(input.size ? { size: input.size } : {}),
    },
    { signal: resolveRequestSignal(request) },
  );
  const parsed = imageResponseSchema.parse(raw);
  const images = (parsed.data ?? [])
    .filter((item): item is { b64_json: string } => typeof item.b64_json === 'string' && item.b64_json.length > 0)
    .map((item) => ({ base64: item.b64_json, mimeType: 'image/png' }));
  if (images.length === 0) {
    throw new ProviderError(PROVIDER_ID, 'response_invalid', 'openai image generation returned no images');
  }
  const output: ImageOutput = { images };
  return {
    output: output as TOutput,
    usage: tokenUsage(parsed.usage?.input_tokens, parsed.usage?.output_tokens, parsed.usage?.total_tokens),
    providerId: PROVIDER_ID,
    modelId: request.modelId,
    externalModelId: request.externalModelId,
    rawResponse: raw,
  };
}

async function executeSpeech<TInput, TOutput>(
  client: OpenAI,
  request: ProviderExecuteRequest<TInput>,
): Promise<ProviderExecuteResponse<TOutput>> {
  const input = speechInputSchema.parse(request.input);
  assertRealtimeModel(request);
  const realtime = await OpenAIRealtimeWebSocket.create(client, { model: OPENAI_REALTIME_MODEL });
  const realtimeRequest = realtimeSignal(request, realtime);
  const chunks: Buffer[] = [];
  realtime.on('response.output_audio.delta', (event) => chunks.push(Buffer.from(event.delta, 'base64')));
  try {
    await raceAbort(realtime.emitted('session.created'), realtimeRequest.signal);
    const delivery = [
      'Read the supplied text verbatim in a clear, calm, natural voice. Do not add, omit, repeat, or summarize words.',
      input.language ? `Use ${input.language} pronunciation.` : '',
      input.speakingRate ? `Speak at ${input.speakingRate} times the normal rate.` : '',
    ].filter(Boolean).join(' ');
    realtime.send({ type: 'session.update', session: { type: 'realtime', model: OPENAI_REALTIME_MODEL, output_modalities: ['audio'], audio: { output: { format: { type: 'audio/pcm', rate: 24_000 }, voice: input.voice } }, instructions: delivery } });
    await raceAbort(realtime.emitted('session.updated'), realtimeRequest.signal);
    realtime.send({ type: 'conversation.item.create', item: { type: 'message', role: 'user', content: [{ type: 'input_text', text: input.text }] } });
    realtime.send({ type: 'response.create', response: { output_modalities: ['audio'] } });
    const done = await raceAbort(realtime.emitted('response.done'), realtimeRequest.signal);
    if (done.response.status !== 'completed' || chunks.length === 0) throw new ProviderError(PROVIDER_ID, 'response_invalid', `Realtime speech ended with status ${done.response.status ?? 'unknown'}`);
    const wav = pcmToWav(Buffer.concat(chunks));
    const output: SpeechOutput = { audioBase64: wav.toString('base64'), mimeType: 'audio/wav' };
    return { output: output as TOutput, usage: realtimeUsage(done.response.usage), providerId: PROVIDER_ID, modelId: request.modelId, externalModelId: request.externalModelId, rawResponse: done.response };
  } finally {
    realtimeRequest.remove();
    realtime.close();
  }
}

export function createOpenAIProvider(config: OpenAIProviderConfig): ProviderAdapter {
  const parsed = openAIProviderConfigSchema.parse(config);
  const client = new OpenAI({
    apiKey: parsed.apiKey,
    baseURL: parsed.baseUrl,
    organization: parsed.organization,
    project: parsed.project,
  });

  return {
    id: PROVIDER_ID,
    name: 'OpenAI',

    async execute<TInput, TOutput>(request: ProviderExecuteRequest<TInput>): Promise<ProviderExecuteResponse<TOutput>> {
      if (CHAT_ACTION_IDS.has(request.actionId) && request.externalModelId === OPENAI_REALTIME_MODEL) {
        return executeRealtimeChat(client, request);
      }
      if (CHAT_ACTION_IDS.has(request.actionId)) {
        return executeOpenAICompatibleChat(PROVIDER_ID, client, request, { maxTokensParam: 'max_completion_tokens' });
      }
      try {
        if (request.actionId === 'generate-image') return await executeImageGenerate(client, request);
        if (request.actionId === 'speak' || request.actionId === 'generate-speech') return await executeSpeech(client, request);
      } catch (err) {
        throw normalizeProviderError(PROVIDER_ID, err);
      }
      throw unsupportedAction(PROVIDER_ID, request.actionId);
    },

    stream(request) {
      if (!CHAT_ACTION_IDS.has(request.actionId)) throw unsupportedAction(PROVIDER_ID, request.actionId);
      if (request.externalModelId === OPENAI_REALTIME_MODEL) return streamRealtimeChat(client, request);
      return streamOpenAICompatibleChat(PROVIDER_ID, client, request, { maxTokensParam: 'max_completion_tokens' });
    },

  };
}

export const openAIProviderFactory: ProviderFactory = {
  id: PROVIDER_ID,
  configSchema: openAIProviderConfigSchema,
  create(config) {
    return createOpenAIProvider(openAIProviderConfigSchema.parse(config));
  },
};
