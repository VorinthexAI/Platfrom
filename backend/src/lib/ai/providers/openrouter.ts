import { z } from 'zod';
import { webInputSchema, webOutputSchema, type WebOutput } from '@/lib/ai/actions/web';
import { speechInputSchema, speechOutputSchema, type SpeechInput, type SpeechOutput } from '@/lib/ai/actions/speech';
import { EMBEDDING_DIMENSIONS } from '@/lib/embedding-constants';
import { tokenUsage, ZERO_TOKEN_USAGE } from '@/lib/ai/shared/usage';
import { normalizeProviderError, ProviderError, providerErrorCodeForStatus } from './errors';
import {
  chatInputSchema,
  embeddingInputSchema,
  imageActionInputSchema,
  imageCaptionInputSchema,
  imageCaptionOutputSchema,
  imageOutputSchema,
  resolveRequestSignal,
  visualIdentityDescriptionInputSchema,
  visualIdentityDescriptionOutputSchema,
  type ChatInput,
  type ChatOutput,
  type EmbeddingOutput,
  type ImageCaptionInput,
  type ImageCaptionOutput,
  type ImageOutput,
  type ProviderAdapter,
  type ProviderEmbedRequest,
  type ProviderEmbedResponse,
  type ProviderExecuteRequest,
  type ProviderExecuteResponse,
  type ProviderFactory,
  type ProviderId,
  type ProviderStreamChunk,
  type VisualIdentityDescriptionOutput,
} from './types';

export const openRouterProviderConfigSchema = z.object({
  apiKey: z.string().min(1),
  baseUrl: z.string().url().default('https://openrouter.ai/api/v1'),
  appUrl: z.string().url().optional(),
  appName: z.string().trim().min(1).max(100).optional(),
}).strict();
export type OpenRouterProviderConfig = z.input<typeof openRouterProviderConfigSchema>;

// ProviderId is updated alongside this adapter in the provider registry change.
const PROVIDER_ID = 'openrouter' as ProviderId;
const SPEECH_CHARACTER_LIMIT = 15_000;

const UPSTREAM_PROVIDER_ROUTING: Readonly<Record<string, { order: readonly string[]; allow_fallbacks: boolean }>> = {
  'google/gemini-3.1-flash-lite': { order: ['google-vertex/us'], allow_fallbacks: false },
};
function upstreamRouting(model: string) {
  return (UPSTREAM_PROVIDER_ROUTING as Record<string, { order: readonly string[]; allow_fallbacks: boolean } | undefined>)[model];
}

const usageSchema = z.object({
  prompt_tokens: z.number().optional(), completion_tokens: z.number().optional(), total_tokens: z.number().optional(), cost: z.number().nullable().optional(),
}).passthrough();
const annotationSchema = z.object({
  type: z.literal('url_citation'),
  url_citation: z.object({ url: z.string(), title: z.string().optional() }).passthrough(),
}).passthrough();
const chatResponseSchema = z.object({
  choices: z.array(z.object({
    message: z.object({
      content: z.string().nullable().optional(),
      tool_calls: z.array(z.object({ id: z.string().min(1), function: z.object({ name: z.string().min(1), arguments: z.string() }).passthrough() }).passthrough()).optional(),
      annotations: z.array(annotationSchema).optional(),
    }).passthrough(),
    finish_reason: z.string().nullable().optional(),
  }).passthrough()).min(1),
  usage: usageSchema.optional(),
}).passthrough();
const embeddingResponseSchema = z.object({
  data: z.array(z.object({ index: z.number().int().nonnegative(), embedding: z.array(z.number().finite()) }).passthrough()),
  usage: usageSchema.optional(),
}).passthrough();
const imageResponseSchema = z.object({
  data: z.array(z.object({ b64_json: z.string().min(1), media_type: z.string().optional() }).passthrough()).min(1),
  usage: usageSchema.optional(),
}).passthrough();
function baseUrl(value: string) { return value.replace(/\/+$/, ''); }
function headers(config: z.output<typeof openRouterProviderConfigSchema>) {
  return {
    authorization: `Bearer ${config.apiKey}`,
    'content-type': 'application/json',
    ...(config.appUrl ? { 'HTTP-Referer': config.appUrl } : { 'HTTP-Referer': 'https://vorinthex.com' }),
    'X-OpenRouter-Title': config.appName ?? 'Vorinthex',
  };
}

function input<T>(schema: z.ZodType<T>, value: unknown, operation: string): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new ProviderError(PROVIDER_ID, 'invalid_input', `OpenRouter ${operation} input is invalid`, { cause: parsed.error });
  return parsed.data;
}
function response<T>(schema: z.ZodType<T>, value: unknown, operation: string): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new ProviderError(PROVIDER_ID, 'response_invalid', `OpenRouter returned an invalid ${operation} response`, { cause: parsed.error });
  return parsed.data;
}
async function openRouterHttpError(result: Response, operation: string, apiKey: string) {
  const body = (await result.text().catch(() => '')).slice(0, 4_000);
  let detail = '';
  try {
    const parsed = JSON.parse(body) as { error?: unknown };
    const error = typeof parsed.error === 'object' && parsed.error !== null ? parsed.error as { code?: unknown; message?: unknown } : undefined;
    detail = JSON.stringify({
      ...(typeof error?.code === 'string' || typeof error?.code === 'number' ? { code: error.code } : {}),
      ...(typeof error?.message === 'string' ? { message: error.message.slice(0, 2_000) } : {}),
    });
  } catch {}
  if (apiKey) detail = detail.replaceAll(apiKey, '[redacted]');
  return new ProviderError(PROVIDER_ID, providerErrorCodeForStatus(result.status), `OpenRouter ${operation} failed with status ${result.status}`, {
    status: result.status,
    cause: new Error(detail || `OpenRouter returned HTTP ${result.status}`),
  });
}
async function post(fetcher: typeof fetch, config: z.output<typeof openRouterProviderConfigSchema>, path: string, body: unknown, request: Pick<ProviderExecuteRequest, 'signal' | 'timeoutMs'>, operation: string) {
  const result = await fetcher(`${baseUrl(config.baseUrl)}${path}`, { method: 'POST', headers: headers(config), body: JSON.stringify(body), signal: resolveRequestSignal(request) });
  if (!result.ok) throw await openRouterHttpError(result, operation, config.apiKey);
  return result;
}

function normalizedContent(parts: ChatInput['messages'][number]['content']): unknown {
  const converted = parts.map((part) => {
    if (part.type === 'text') return { type: 'text', text: part.text };
    if (part.type === 'image') return { type: 'image_url', image_url: { url: `data:${part.mimeType};base64,${Buffer.from(part.bytes).toString('base64')}` } };
    return undefined;
  }).filter((part) => part !== undefined);
  return converted.length === 1 && (converted[0] as { type?: string }).type === 'text' ? (converted[0] as { text: string }).text : converted;
}

function chatMessages(chat: ChatInput) {
  const messages: Array<Record<string, unknown>> = [];
  const toolNames = new Map<string, string>();
  if (chat.systemPrompt) messages.push({ role: 'system', content: chat.systemPrompt });
  for (const message of chat.messages) {
    const calls = message.content.filter((part) => part.type === 'tool-call');
    const results = message.content.filter((part) => part.type === 'tool-result');
    const regular = message.content.filter((part) => part.type !== 'tool-call' && part.type !== 'tool-result');
    if (message.role === 'assistant') {
      calls.forEach((call) => toolNames.set(call.toolCallId, call.name));
      messages.push({ role: 'assistant', content: regular.length ? normalizedContent(regular) : null, ...(calls.length ? { tool_calls: calls.map((call) => ({ id: call.toolCallId, type: 'function', function: { name: call.name, arguments: JSON.stringify(call.arguments) } })) } : {}) });
    } else if (message.role === 'tool') {
      if (results.length !== 1 || regular.length || calls.length) throw new ProviderError(PROVIDER_ID, 'invalid_input', 'OpenRouter tool messages require exactly one tool result');
      const result = results[0]!;
      if (!toolNames.has(result.toolCallId)) throw new ProviderError(PROVIDER_ID, 'invalid_input', 'OpenRouter tool results require a preceding matching tool call');
      messages.push({ role: 'tool', tool_call_id: result.toolCallId, content: JSON.stringify(result.result) });
    } else {
      if (calls.length || results.length) throw new ProviderError(PROVIDER_ID, 'invalid_input', `OpenRouter ${message.role} messages cannot contain tool content`);
      messages.push({ role: message.role, content: normalizedContent(regular) });
    }
  }
  return messages;
}

function chatBody(chat: ChatInput, model: string, stream = false) {
  const routing = upstreamRouting(model);
  return {
    model,
    messages: chatMessages(chat),
    ...(routing ? { provider: routing } : {}),
    ...(chat.tools?.length ? { tools: chat.tools.map((tool) => ({ type: 'function', function: { name: tool.name, description: tool.description, parameters: tool.inputSchema } })) } : {}),
    ...(chat.responseFormat ? { response_format: { type: 'json_schema', json_schema: { name: chat.responseFormat.name, strict: true, schema: chat.responseFormat.schema } } } : {}),
    ...(chat.options?.temperature !== undefined ? { temperature: chat.options.temperature } : {}),
    ...(chat.options?.maxTokens !== undefined ? { max_tokens: chat.options.maxTokens } : {}),
    ...(stream ? { stream: true, stream_options: { include_usage: true } } : {}),
  };
}
function parseToolArguments(value: string) {
  try { return JSON.parse(value) as unknown; } catch (error) { throw new ProviderError(PROVIDER_ID, 'response_invalid', 'OpenRouter returned invalid tool arguments', { cause: error }); }
}
function normalizeChat(raw: z.infer<typeof chatResponseSchema>) {
  const choice = raw.choices[0]!;
  const toolCalls = (choice.message.tool_calls ?? []).map((call) => ({ id: call.id, name: call.function.name, arguments: parseToolArguments(call.function.arguments) }));
  const output: ChatOutput = { text: choice.message.content ?? '', toolCalls, stopReason: toolCalls.length ? 'tool_use' : choice.finish_reason ?? null };
  if (!output.text && !toolCalls.length) throw new ProviderError(PROVIDER_ID, 'response_invalid', 'OpenRouter returned no text or tool calls');
  return { output, usage: tokenUsage(raw.usage?.prompt_tokens, raw.usage?.completion_tokens, raw.usage?.total_tokens), costUsd: raw.usage?.cost ?? undefined };
}

async function executeChat<TInput, TOutput>(fetcher: typeof fetch, config: z.output<typeof openRouterProviderConfigSchema>, request: ProviderExecuteRequest<TInput>) {
  const chat = input(chatInputSchema, request.input, 'text');
  const result = await post(fetcher, config, '/chat/completions', chatBody(chat, request.externalModelId), request, 'text request');
  const raw = response(chatResponseSchema, await result.json().catch(() => undefined), 'text');
  const normalized = normalizeChat(raw);
  return { output: normalized.output as TOutput, usage: normalized.usage, ...(normalized.costUsd !== undefined ? { costUsd: normalized.costUsd } : {}), providerId: PROVIDER_ID, modelId: request.modelId, externalModelId: request.externalModelId, rawResponse: raw };
}

async function executeWeb<TInput, TOutput>(fetcher: typeof fetch, config: z.output<typeof openRouterProviderConfigSchema>, request: ProviderExecuteRequest<TInput>): Promise<ProviderExecuteResponse<TOutput>> {
  const value = input(webInputSchema.omit({ mode: true }), request.input, 'web');
  const result = await post(fetcher, config, '/chat/completions', {
    model: request.externalModelId,
    messages: [{ role: 'user', content: value.prompt }],
    ...(upstreamRouting(request.externalModelId) ? { provider: upstreamRouting(request.externalModelId) } : {}),
    tools: [{ type: 'openrouter:web_search', parameters: { engine: 'native', max_results: 5, max_uses: 2, max_total_results: 10 } }],
    max_tool_calls: 2,
    ...(value.responseFormat ? { response_format: { type: 'json_schema', json_schema: { name: value.responseFormat.name, strict: true, schema: value.responseFormat.schema } } } : {}),
  }, request, 'web request');
  const raw = response(chatResponseSchema, await result.json().catch(() => undefined), 'web');
  const choice = raw.choices[0]!;
  const text = choice.message.content?.trim() ?? '';
  const seen = new Set<string>();
  const citations = (choice.message.annotations ?? []).flatMap(({ url_citation: citation }) => {
    let url: URL;
    try { url = new URL(citation.url); } catch { return []; }
    if (url.protocol !== 'https:' || seen.has(citation.url)) return [];
    seen.add(citation.url);
    return [{ title: citation.title?.trim() || url.hostname, url: citation.url }];
  });
  const output: WebOutput = webOutputSchema.parse({ text, citations, sources: citations.map(({ url }) => url) });
  return { output: output as TOutput & WebOutput, usage: tokenUsage(raw.usage?.prompt_tokens, raw.usage?.completion_tokens, raw.usage?.total_tokens), ...(raw.usage?.cost != null ? { costUsd: raw.usage.cost } : {}), providerId: PROVIDER_ID, modelId: request.modelId, externalModelId: request.externalModelId, rawResponse: raw };
}

async function createEmbeddings(fetcher: typeof fetch, config: z.output<typeof openRouterProviderConfigSchema>, request: ProviderEmbedRequest): Promise<ProviderEmbedResponse> {
  if (request.dimensions !== undefined && request.dimensions !== EMBEDDING_DIMENSIONS) throw new ProviderError(PROVIDER_ID, 'invalid_input', `OpenRouter embeddings require ${EMBEDDING_DIMENSIONS} dimensions`);
  const values = typeof request.input === 'string' ? [request.input] : request.input;
  if (!values.length || values.some((value) => !value.trim())) throw new ProviderError(PROVIDER_ID, 'invalid_input', 'OpenRouter embedding input must be non-empty');
  const result = await post(fetcher, config, '/embeddings', { model: request.externalModelId, input: request.input, encoding_format: 'float', dimensions: EMBEDDING_DIMENSIONS }, request, 'embedding request');
  const raw = response(embeddingResponseSchema, await result.json().catch(() => undefined), 'embedding');
  const ordered = [...raw.data].sort((left, right) => left.index - right.index);
  if (ordered.length !== values.length || ordered.some((item, index) => item.index !== index)) throw new ProviderError(PROVIDER_ID, 'response_invalid', 'OpenRouter embeddings returned invalid indices');
  const embeddings = ordered.map(({ embedding }) => embedding);
  if (embeddings.some((embedding) => embedding.length !== EMBEDDING_DIMENSIONS)) throw new ProviderError(PROVIDER_ID, 'response_invalid', 'OpenRouter embeddings returned invalid vectors');
  return { embeddings, usage: tokenUsage(raw.usage?.prompt_tokens, 0, raw.usage?.total_tokens), providerId: PROVIDER_ID, externalModelId: request.externalModelId, rawResponse: raw };
}
function chunkText(text: string, maxCharacters: number, overlapCharacters: number) {
  const chunks: string[] = [];
  let start = 0;
  while (start < text.length) {
    let end = Math.min(text.length, start + maxCharacters);
    if (end < text.length) { const boundary = text.lastIndexOf(' ', end); if (boundary > start + maxCharacters / 2) end = boundary; }
    const chunk = text.slice(start, end).trim();
    if (chunk) chunks.push(chunk);
    if (end >= text.length) break;
    start = Math.max(start + 1, end - overlapCharacters);
  }
  return chunks;
}

async function generateImage<TInput, TOutput>(fetcher: typeof fetch, config: z.output<typeof openRouterProviderConfigSchema>, request: ProviderExecuteRequest<TInput>): Promise<ProviderExecuteResponse<TOutput>> {
  const value = imageActionInputSchema.parse({ operation: 'generate', ...request.input as object });
  if (value.operation !== 'generate') throw new ProviderError(PROVIDER_ID, 'invalid_input', 'OpenRouter image generation input is invalid');
  if (value.count !== 1) throw new ProviderError(PROVIDER_ID, 'invalid_input', 'OpenRouter image generation requires count 1');
  const ratioBySize = { '1024x1024': '1:1', '1024x1536': '2:3', '1536x1024': '3:2' } as const;
  const result = await post(fetcher, config, '/images', {
    model: request.externalModelId, prompt: value.prompt, n: 1,
    resolution: '1K',
    ...((value.aspectRatio ?? (value.size ? ratioBySize[value.size] : undefined)) ? { aspect_ratio: value.aspectRatio ?? ratioBySize[value.size!] } : {}),
    ...(value.outputFormat ? { output_format: value.outputFormat } : {}),
    ...(value.inputReferences?.length ? { input_references: value.inputReferences.map((url) => ({ type: 'image_url', image_url: { url } })) } : {}),
  }, request, 'image request');
  const raw = response(imageResponseSchema, await result.json().catch(() => undefined), 'image');
  const fallback = 'image/png';
  const output: ImageOutput = imageOutputSchema.parse({ images: raw.data.map((item) => ({ base64: item.b64_json, mimeType: item.media_type ?? fallback })) });
  return { output: output as TOutput, usage: tokenUsage(raw.usage?.prompt_tokens, raw.usage?.completion_tokens, raw.usage?.total_tokens), ...(raw.usage?.cost != null ? { costUsd: raw.usage.cost } : {}), providerId: PROVIDER_ID, modelId: request.modelId, externalModelId: request.externalModelId, rawResponse: raw };
}

function captionInstruction(value: ImageCaptionInput) {
  const json = 'Respond with only valid JSON in exactly this shape: {"results":[{"caption":"description","score":90}]}. Include exactly one ordered result per image and no Markdown or explanatory text.';
  if (value.purpose === 'document-transcription') return `Transcribe all visible text from each of the ${value.imageUrls.length} document images as clean plain text. Preserve structure and do not summarize. Score source legibility and quality from 1 to 100. ${json}`;
  if (value.purpose === 'document-reconciliation') return `Produce the best faithful transcription for each of the ${value.imageUrls.length} images. Compare the supplied primary and secondary text against each image, prefer the primary source on conflicts, and repair clear OCR errors. Score legibility and quality from 1 to 100. ${json}`;
  if (value.purpose === 'artwork-compliance') return `Inspect each of the ${value.imageUrls.length} images. An image is compliant only when it contains no person or human-like subject, no visible writing or text-like mark, and no botanical, fungal, or vegetation imagery. Use caption "compliant" and score 100 only when compliant; otherwise describe violations and score 1. ${json}`;
  return `Write one rich factual caption for each of the ${value.imageUrls.length} images, preserving order. Describe visible subjects, actions, setting, composition, colors, lighting, style, and readable text without speculation. Score image quality from 1 to 100. ${json}`;
}

async function executeStructuredImage<TOutput>(fetcher: typeof fetch, config: z.output<typeof openRouterProviderConfigSchema>, request: ProviderExecuteRequest, content: unknown[], name: string, schema: Record<string, unknown>, parse: (value: unknown) => TOutput): Promise<ProviderExecuteResponse<TOutput>> {
  const result = await post(fetcher, config, '/chat/completions', { model: request.externalModelId, messages: [{ role: 'user', content }], max_tokens: 2_048, temperature: 0, response_format: { type: 'json_schema', json_schema: { name, strict: true, schema } } }, request, 'image analysis request');
  const raw = response(chatResponseSchema, await result.json().catch(() => undefined), 'image analysis');
  const text = raw.choices[0]!.message.content;
  if (!text) throw new ProviderError(PROVIDER_ID, 'response_invalid', 'OpenRouter returned no image analysis text');
  let value: unknown;
  try {
    const trimmed = text.trim();
    const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(trimmed)?.[1];
    const candidate = fenced ?? trimmed.slice(trimmed.indexOf('{'), trimmed.lastIndexOf('}') + 1);
    value = JSON.parse(candidate);
  } catch (error) { throw new ProviderError(PROVIDER_ID, 'response_invalid', 'OpenRouter returned invalid image analysis JSON', { cause: error }); }
  return { output: parse(value), usage: tokenUsage(raw.usage?.prompt_tokens, raw.usage?.completion_tokens, raw.usage?.total_tokens), ...(raw.usage?.cost != null ? { costUsd: raw.usage.cost } : {}), providerId: PROVIDER_ID, modelId: request.modelId, externalModelId: request.externalModelId, rawResponse: raw };
}

async function captionImages<TOutput>(fetcher: typeof fetch, config: z.output<typeof openRouterProviderConfigSchema>, request: ProviderExecuteRequest): Promise<ProviderExecuteResponse<TOutput>> {
  const value = imageCaptionInputSchema.parse(request.input);
  const content: unknown[] = [{ type: 'text', text: captionInstruction(value) }];
  value.imageUrls.forEach((url, index) => {
    content.push({ type: 'text', text: `Image ${index + 1}:` });
    const references = value.referenceTexts?.[index];
    if (references) content.push({ type: 'text', text: `Primary text:\n${references.primary}\n\nSecondary text:\n${references.secondary}` });
    content.push({ type: 'image_url', image_url: { url } });
  });
  const schema = { type: 'object', additionalProperties: false, required: ['results'], properties: { results: { type: 'array', minItems: value.imageUrls.length, maxItems: value.imageUrls.length, items: { type: 'object', additionalProperties: false, required: ['caption', 'score'], properties: { caption: { type: 'string' }, score: { type: 'integer', minimum: 1, maximum: 100 } } } } } };
  return executeStructuredImage(fetcher, config, request, content, 'image_captions', schema, (raw) => imageCaptionOutputSchema.parse(raw) as TOutput & ImageCaptionOutput);
}

async function describeVisualIdentity<TOutput>(fetcher: typeof fetch, config: z.output<typeof openRouterProviderConfigSchema>, request: ProviderExecuteRequest): Promise<ProviderExecuteResponse<TOutput>> {
  const value = visualIdentityDescriptionInputSchema.parse(request.input);
  const content: unknown[] = [{ type: 'text', text: 'The reference images show the same specific visual subject. Write one exhaustive factual recognition profile covering stable visible identifiers and distinguishing this exact subject from similar subjects. Exclude temporary context and unsupported guesses. Respond with only valid JSON in exactly this shape: {"description":"recognition profile"}. Do not include Markdown or explanatory text.' }];
  value.imageUrls.forEach((url, index) => content.push({ type: 'text', text: `Reference image ${index + 1}:` }, { type: 'image_url', image_url: { url } }));
  const schema = { type: 'object', additionalProperties: false, required: ['description'], properties: { description: { type: 'string' } } };
  return executeStructuredImage(fetcher, config, request, content, 'visual_identity', schema, (raw) => visualIdentityDescriptionOutputSchema.parse(raw) as TOutput & VisualIdentityDescriptionOutput);
}

const voiceIds: Record<SpeechInput['voice'], string> = { alloy: 'ara', coral: 'eve', nova: 'leo', sage: 'sal' };
export function splitOpenRouterSpeechText(text: string): string[] {
  const chunks: string[] = [];
  let chunk = '';
  for (const segment of text.split(/(?<=[.!?])\s+|\n+/)) {
    const value = segment.trim();
    if (!value) continue;
    if (value.length > SPEECH_CHARACTER_LIMIT) {
      if (chunk) { chunks.push(chunk); chunk = ''; }
      for (let offset = 0; offset < value.length; offset += SPEECH_CHARACTER_LIMIT) chunks.push(value.slice(offset, offset + SPEECH_CHARACTER_LIMIT));
      continue;
    }
    const candidate = chunk ? `${chunk} ${value}` : value;
    if (candidate.length > SPEECH_CHARACTER_LIMIT) { chunks.push(chunk); chunk = value; } else chunk = candidate;
  }
  if (chunk) chunks.push(chunk);
  return chunks;
}
interface Mp3Frame { length: number; sampleRate: number; samples: number }
function readMp3Frame(bytes: Uint8Array, offset: number): Mp3Frame | undefined {
  if (offset + 4 > bytes.length) return undefined;
  const header = ((bytes[offset]! << 24) | (bytes[offset + 1]! << 16) | (bytes[offset + 2]! << 8) | bytes[offset + 3]!) >>> 0;
  if (((header & 0xffe00000) >>> 0) !== 0xffe00000) return undefined;
  const version = (header >>> 19) & 3; const layer = (header >>> 17) & 3; const bitrate = (header >>> 12) & 15; const rate = (header >>> 10) & 3;
  if (version === 1 || layer !== 1 || bitrate === 0 || bitrate === 15 || rate === 3) return undefined;
  const mpeg1 = version === 3;
  const bitrates = mpeg1 ? [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320] : [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160];
  const sampleRate = [44_100, 48_000, 32_000][rate]! / (version === 2 ? 2 : version === 0 ? 4 : 1);
  const length = Math.floor(((mpeg1 ? 144 : 72) * bitrates[bitrate]! * 1_000) / sampleRate) + ((header >>> 9) & 1);
  return length >= 4 ? { length, sampleRate, samples: mpeg1 ? 1_152 : 576 } : undefined;
}
export function extractOpenRouterMp3Frames(audio: Uint8Array) {
  const frames: Uint8Array[] = [];
  let durationSeconds = 0; let offset = 0;
  while (offset + 4 <= audio.length) {
    const frame = readMp3Frame(audio, offset);
    if (!frame || offset + frame.length > audio.length) { offset += 1; continue; }
    frames.push(audio.subarray(offset, offset + frame.length)); durationSeconds += frame.samples / frame.sampleRate; offset += frame.length;
  }
  if (!frames.length) throw new ProviderError(PROVIDER_ID, 'response_invalid', 'OpenRouter returned invalid MP3 audio');
  return { bytes: Buffer.concat(frames), durationSeconds };
}
async function generateSpeech<TInput, TOutput>(fetcher: typeof fetch, config: z.output<typeof openRouterProviderConfigSchema>, request: ProviderExecuteRequest<TInput>): Promise<ProviderExecuteResponse<TOutput>> {
  const value = input(speechInputSchema, request.input, 'speech');
  const chunks = splitOpenRouterSpeechText(value.text); const audio: Uint8Array[] = []; let durationSeconds = 0;
  for (const text of chunks) {
    const result = await post(fetcher, config, '/audio/speech', { model: request.externalModelId, input: text, voice: voiceIds[value.voice], response_format: 'mp3' }, request, 'speech request');
    if (!(result.headers.get('content-type') ?? '').toLowerCase().startsWith('audio/mpeg')) throw new ProviderError(PROVIDER_ID, 'response_invalid', 'OpenRouter returned non-MP3 speech audio');
    const parsed = extractOpenRouterMp3Frames(new Uint8Array(await result.arrayBuffer()));
    audio.push(parsed.bytes); durationSeconds += parsed.durationSeconds;
  }
  const output: SpeechOutput = speechOutputSchema.parse({ base64: Buffer.concat(audio).toString('base64'), mimeType: 'audio/mpeg', durationSeconds: Math.max(1, Math.ceil(durationSeconds)) });
  return { output: output as TOutput, usage: ZERO_TOKEN_USAGE, providerId: PROVIDER_ID, modelId: request.modelId, externalModelId: request.externalModelId, rawResponse: { chunks: chunks.length } };
}

async function* streamChat<TInput>(fetcher: typeof fetch, config: z.output<typeof openRouterProviderConfigSchema>, request: ProviderExecuteRequest<TInput>): AsyncIterable<ProviderStreamChunk> {
  try {
    const chat = input(chatInputSchema, request.input, 'text stream');
    const result = await post(fetcher, config, '/chat/completions', chatBody(chat, request.externalModelId, true), request, 'text stream');
    if (!result.body) throw new ProviderError(PROVIDER_ID, 'response_invalid', 'OpenRouter returned no stream body');
    const reader = result.body.getReader(); const decoder = new TextDecoder(); let buffer = ''; let sawDone = false; let finishReason: string | null | undefined;
    const toolCalls = new Map<number, { id: string; name: string; arguments: string }>();
    const parseEvent = (event: string): ProviderStreamChunk[] => {
      const data = event.split(/\r?\n/).filter((line) => line.startsWith('data:')).map((line) => line.slice(5).trim()).join('');
      if (!data) return [];
      if (data === '[DONE]') { sawDone = true; return []; }
      let json: unknown; try { json = JSON.parse(data); } catch (error) { throw new ProviderError(PROVIDER_ID, 'response_invalid', 'OpenRouter returned malformed stream JSON', { cause: error }); }
      const parsed = response(z.object({ choices: z.array(z.object({ delta: z.object({ content: z.string().nullable().optional(), tool_calls: z.array(z.object({ index: z.number().int().nonnegative(), id: z.string().optional(), function: z.object({ name: z.string().optional(), arguments: z.string().optional() }).optional() }).passthrough()).optional() }).passthrough(), finish_reason: z.string().nullable().optional() }).passthrough()).optional(), usage: usageSchema.optional() }).passthrough(), json, 'stream event');
      const chunks: ProviderStreamChunk[] = []; const choice = parsed.choices?.[0];
      if (choice?.finish_reason != null) {
        if (finishReason !== undefined && finishReason !== null && finishReason !== choice.finish_reason) throw new ProviderError(PROVIDER_ID, 'response_invalid', 'OpenRouter returned conflicting stream finish reasons');
        finishReason = choice.finish_reason;
      }
      const text = choice?.delta.content; if (text) chunks.push({ type: 'text-delta', text });
      for (const part of choice?.delta.tool_calls ?? []) {
        const current = toolCalls.get(part.index) ?? { id: '', name: '', arguments: '' };
        if (part.id && current.id && current.id !== part.id) throw new ProviderError(PROVIDER_ID, 'response_invalid', 'OpenRouter changed a streamed tool call id');
        if (part.id) current.id = part.id;
        if (part.function?.name) current.name += part.function.name;
        if (part.function?.arguments) current.arguments += part.function.arguments;
        toolCalls.set(part.index, current);
      }
      if (parsed.usage) chunks.push({ type: 'usage', usage: tokenUsage(parsed.usage.prompt_tokens, parsed.usage.completion_tokens, parsed.usage.total_tokens) });
      return chunks;
    };
    try {
      while (true) {
        const read = await reader.read(); buffer += decoder.decode(read.value, { stream: !read.done });
        const events = buffer.split(/\r?\n\r?\n/); buffer = events.pop() ?? '';
        for (const event of events) for (const chunk of parseEvent(event)) yield chunk;
        if (read.done) break;
      }
      if (buffer.trim()) for (const chunk of parseEvent(buffer)) yield chunk;
    } finally { reader.releaseLock(); }
    if (!sawDone) throw new ProviderError(PROVIDER_ID, 'response_invalid', 'OpenRouter stream ended before completion');
    if (toolCalls.size ? finishReason !== 'tool_calls' : finishReason === 'tool_calls' || finishReason == null) throw new ProviderError(PROVIDER_ID, 'response_invalid', 'OpenRouter stream finish reason did not match its tool calls');
    for (const [, call] of [...toolCalls.entries()].sort(([left], [right]) => left - right)) {
      if (!call.id || !call.name) throw new ProviderError(PROVIDER_ID, 'response_invalid', 'OpenRouter returned an incomplete streamed tool call');
      yield { type: 'tool-call', toolCall: { id: call.id, name: call.name, arguments: parseToolArguments(call.arguments) } };
    }
    yield { type: 'done' };
  } catch (error) { throw normalizeProviderError(PROVIDER_ID, error); }
}

export function createOpenRouterProvider(config: OpenRouterProviderConfig, fetcher: typeof fetch = fetch): ProviderAdapter {
  const parsed = openRouterProviderConfigSchema.parse(config);
  return {
    id: PROVIDER_ID,
    name: 'OpenRouter',
    async execute<TInput, TOutput>(request: ProviderExecuteRequest<TInput>) {
      try {
        if (request.actionId === 'text') return await executeChat<TInput, TOutput>(fetcher, parsed, request);
        if (request.actionId === 'web') return await executeWeb<TInput, TOutput>(fetcher, parsed, request);
        if (request.actionId === 'image') {
          const imageInput = imageActionInputSchema.parse(request.input);
          const { operation, ...operationInput } = imageInput;
          const operationRequest = { ...request, input: operationInput };
          if (operation === 'generate') return await generateImage<typeof operationInput, TOutput>(fetcher, parsed, operationRequest);
          if (operation === 'caption') return await captionImages<TOutput>(fetcher, parsed, operationRequest);
          return await describeVisualIdentity<TOutput>(fetcher, parsed, operationRequest);
        }
        if (request.actionId === 'speech') return await generateSpeech<TInput, TOutput>(fetcher, parsed, request);
        if (request.actionId === 'embed') {
          const value = input(embeddingInputSchema, request.input, 'embedding');
          const texts = value.chunking?.enabled ? chunkText(value.text, value.chunking.maxCharacters ?? 8_000, value.chunking.overlapCharacters ?? 400) : [value.text];
          const embedded = await createEmbeddings(fetcher, parsed, { externalModelId: request.externalModelId, input: texts, dimensions: EMBEDDING_DIMENSIONS, timeoutMs: request.timeoutMs, signal: request.signal });
          const output: EmbeddingOutput = { embedding: embedded.embeddings[0]!, ...(value.chunking?.enabled ? { chunks: texts.map((text, index) => ({ text, embedding: embedded.embeddings[index]! })) } : {}) };
          return { output: output as TOutput & EmbeddingOutput, usage: embedded.usage, providerId: PROVIDER_ID, modelId: request.modelId, externalModelId: request.externalModelId, rawResponse: embedded.rawResponse };
        }
        throw new ProviderError(PROVIDER_ID, 'unsupported_action', `OpenRouter does not implement action ${request.actionId}`);
      } catch (error) { throw normalizeProviderError(PROVIDER_ID, error); }
    },
    stream<TInput>(request: ProviderExecuteRequest<TInput>) {
      if (request.actionId !== 'text') throw new ProviderError(PROVIDER_ID, 'unsupported_action', `OpenRouter does not stream action ${request.actionId}`);
      return streamChat(fetcher, parsed, request);
    },
    async embed(request) { try { return await createEmbeddings(fetcher, parsed, request); } catch (error) { throw normalizeProviderError(PROVIDER_ID, error); } },
  };
}

export const openRouterProviderFactory: ProviderFactory = {
  id: PROVIDER_ID,
  configSchema: openRouterProviderConfigSchema,
  create(config) { return createOpenRouterProvider(openRouterProviderConfigSchema.parse(config)); },
};
