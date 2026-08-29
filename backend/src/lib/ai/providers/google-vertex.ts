import sharp from 'sharp';
import { z } from 'zod';
import { webSearchInputSchema, webSearchOutputSchema, type WebSearchOutput } from '@/lib/ai/actions/web-search';
import { tokenUsage } from '@/lib/ai/shared/usage';
import { normalizeProviderError, ProviderError, providerErrorCodeForStatus } from './errors';
import {
  chatInputSchema,
  imageCaptionInputSchema,
  imageCaptionOutputSchema,
  imageGenerateInputSchema,
  imageOutputSchema,
  resolveRequestSignal,
  visualIdentityDescriptionInputSchema,
  visualIdentityDescriptionOutputSchema,
  type ChatInput,
  type ChatOutput,
  type ImageCaptionInput,
  type ImageCaptionOutput,
  type ImageGenerateInput,
  type ImageOutput,
  type ProviderAdapter,
  type ProviderExecuteRequest,
  type ProviderExecuteResponse,
  type ProviderFactory,
  type ProviderStreamChunk,
  type VisualIdentityDescriptionInput,
  type VisualIdentityDescriptionOutput,
} from './types';

export const googleVertexProviderConfigSchema = z
  .object({
    apiKey: z.string().min(1).optional(),
    accessToken: z.string().min(1).optional(),
    projectId: z.string().min(1).optional(),
    location: z.string().min(1).default('global'),
  })
  .strict()
  .refine((config) => Boolean(config.apiKey) || Boolean(config.accessToken && config.projectId), {
    message: 'google-vertex requires either apiKey or accessToken + projectId',
  });

export type GoogleVertexProviderConfig = z.input<typeof googleVertexProviderConfigSchema>;
export const googleVertexCredentialsSchema = googleVertexProviderConfigSchema;
export type GoogleVertexCredentials = GoogleVertexProviderConfig;

const PROVIDER_ID = 'google-vertex' as const;

const partSchema = z.object({
  text: z.string().optional(),
  inlineData: z.object({ mimeType: z.string().min(1), data: z.string().min(1) }).passthrough().optional(),
  functionCall: z.object({ id: z.string().optional(), name: z.string().min(1), args: z.unknown().optional() }).passthrough().optional(),
  thoughtSignature: z.string().optional(),
}).passthrough();
const responseSchema = z.object({
  candidates: z.array(z.object({
    content: z.object({ parts: z.array(partSchema).optional() }).passthrough().optional(),
    finishReason: z.string().optional(),
    groundingMetadata: z.object({
      webSearchQueries: z.array(z.string()).optional(),
      groundingChunks: z.array(z.object({ web: z.object({ uri: z.string(), title: z.string().optional() }).passthrough().optional() }).passthrough()).optional(),
    }).passthrough().optional(),
  }).passthrough()).optional(),
  usageMetadata: z.object({ promptTokenCount: z.number().optional(), candidatesTokenCount: z.number().optional(), totalTokenCount: z.number().optional() }).passthrough().optional(),
}).passthrough();

type VertexPart = Record<string, unknown>;
interface VertexContent { role: 'user' | 'model'; parts: VertexPart[] }

function endpoint(config: z.output<typeof googleVertexProviderConfigSchema>, modelId: string, method: 'generateContent' | 'streamGenerateContent', location = config.location) {
  const model = encodeURIComponent(modelId);
  const query = new URLSearchParams();
  if (method === 'streamGenerateContent') query.set('alt', 'sse');
  let url: string;
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (config.projectId) {
    const host = location === 'global' ? 'aiplatform.googleapis.com' : `${location}-aiplatform.googleapis.com`;
    url = `https://${host}/v1/projects/${encodeURIComponent(config.projectId)}/locations/${encodeURIComponent(location)}/publishers/google/models/${model}:${method}`;
    if (config.accessToken) headers.Authorization = `Bearer ${config.accessToken}`;
    else headers['x-goog-api-key'] = config.apiKey ?? '';
  } else {
    url = `https://aiplatform.googleapis.com/v1/publishers/google/models/${model}:${method}`;
    headers['x-goog-api-key'] = config.apiKey ?? '';
  }
  const suffix = query.toString();
  return { url: suffix ? `${url}?${suffix}` : url, headers };
}

async function requestVertex(fetcher: typeof fetch, config: z.output<typeof googleVertexProviderConfigSchema>, modelId: string, body: unknown, request: Pick<ProviderExecuteRequest, 'signal' | 'timeoutMs'>, location?: string) {
  const target = endpoint(config, modelId, 'generateContent', location);
  const response = await fetcher(target.url, { method: 'POST', headers: target.headers, body: JSON.stringify(body), signal: resolveRequestSignal(request) });
  if (!response.ok) throw new ProviderError(PROVIDER_ID, providerErrorCodeForStatus(response.status), `google-vertex request failed with status ${response.status}`, { status: response.status });
  return responseSchema.parse(await response.json());
}

function buildChatBody(input: ChatInput) {
  const contents: VertexContent[] = [];
  const systemParts: string[] = input.systemPrompt ? [input.systemPrompt] : [];
  const toolNames = new Map<string, string>();
  for (const message of input.messages) {
    const parts: VertexPart[] = [];
    for (const part of message.content) {
      if (part.type === 'text') parts.push({ text: part.text });
      else if (part.type === 'tool-call' && message.role === 'assistant') {
        toolNames.set(part.toolCallId, part.name);
        parts.push({ functionCall: { id: part.toolCallId, name: part.name, args: part.arguments }, ...(part.opaqueState ? { thoughtSignature: part.opaqueState } : {}) });
      } else if (part.type === 'tool-result' && message.role === 'tool') {
        const name = toolNames.get(part.toolCallId);
        if (!name) throw new ProviderError(PROVIDER_ID, 'invalid_input', 'Google Vertex tool results require a preceding matching tool call');
        parts.push({ functionResponse: { id: part.toolCallId, name, response: { output: part.result } } });
      } else {
        throw new ProviderError(PROVIDER_ID, 'unsupported_action', 'Google Vertex does not support this core chat content');
      }
    }
    if (message.role === 'system') {
      const texts = parts.flatMap((part) => typeof part.text === 'string' ? [part.text] : []);
      if (texts.length !== parts.length) throw new ProviderError(PROVIDER_ID, 'invalid_input', 'System messages must contain only text');
      systemParts.push(...texts);
    } else {
      contents.push({ role: message.role === 'assistant' ? 'model' : 'user', parts });
    }
  }
  const body: Record<string, unknown> = { contents };
  if (systemParts.length) body.systemInstruction = { parts: systemParts.map((text) => ({ text })) };
  if (input.tools?.length) body.tools = [{ functionDeclarations: input.tools.map((tool) => ({ name: tool.name, description: tool.description, parameters: tool.inputSchema })) }];
  const generationConfig: Record<string, unknown> = {};
  if (input.options?.maxTokens !== undefined) generationConfig.maxOutputTokens = input.options.maxTokens;
  if (input.options?.temperature !== undefined) generationConfig.temperature = input.options.temperature;
  if (input.responseFormat) {
    generationConfig.responseMimeType = 'application/json';
    generationConfig.responseSchema = input.responseFormat.schema;
  }
  if (Object.keys(generationConfig).length) body.generationConfig = generationConfig;
  return body;
}

function normalizeChat(raw: z.infer<typeof responseSchema>): { output: ChatOutput; usage: ReturnType<typeof tokenUsage> } {
  const candidate = raw.candidates?.[0];
  if (!candidate) throw new ProviderError(PROVIDER_ID, 'response_invalid', 'google-vertex returned no candidates');
  if (candidate.finishReason && !['STOP', 'MAX_TOKENS'].includes(candidate.finishReason)) throw new ProviderError(PROVIDER_ID, 'response_invalid', `google-vertex response ended with ${candidate.finishReason}`);
  const parts = candidate.content?.parts ?? [];
  const toolCalls = parts.flatMap((part, index) => part.functionCall ? [{
    id: part.functionCall.id ?? `vertex-call-${index + 1}`,
    name: part.functionCall.name,
    arguments: part.functionCall.args ?? {},
    ...(part.thoughtSignature ? { opaqueState: part.thoughtSignature } : {}),
  }] : []);
  const text = parts.map((part) => part.text ?? '').join('');
  if (!text && toolCalls.length === 0) throw new ProviderError(PROVIDER_ID, 'response_invalid', 'google-vertex returned no text or tool calls');
  return {
    output: { text, toolCalls, stopReason: toolCalls.length ? 'tool_use' : candidate.finishReason?.toLowerCase() ?? null },
    usage: tokenUsage(raw.usageMetadata?.promptTokenCount, raw.usageMetadata?.candidatesTokenCount, raw.usageMetadata?.totalTokenCount),
  };
}

async function executeChat<TInput, TOutput>(fetcher: typeof fetch, config: z.output<typeof googleVertexProviderConfigSchema>, request: ProviderExecuteRequest<TInput>): Promise<ProviderExecuteResponse<TOutput>> {
  const raw = await requestVertex(fetcher, config, request.externalModelId, buildChatBody(chatInputSchema.parse(request.input)), request);
  const normalized = normalizeChat(raw);
  return { output: normalized.output as TOutput, usage: normalized.usage, providerId: PROVIDER_ID, modelId: request.modelId, externalModelId: request.externalModelId, rawResponse: raw };
}

function imagePart(url: string): VertexPart {
  if (url.startsWith('data:')) {
    const match = /^data:(image\/(?:gif|jpeg|png|webp));base64,([A-Za-z0-9+/]+={0,2})$/.exec(url);
    if (!match) throw new ProviderError(PROVIDER_ID, 'invalid_input', 'Google Vertex received an invalid inline image');
    return { inlineData: { mimeType: match[1], data: match[2] } };
  }
  const pathname = new URL(url).pathname.toLowerCase();
  const mimeType = pathname.endsWith('.png') ? 'image/png' : pathname.endsWith('.webp') ? 'image/webp' : pathname.endsWith('.gif') ? 'image/gif' : 'image/jpeg';
  return { fileData: { mimeType, fileUri: url } };
}

function captionInstruction(input: ImageCaptionInput) {
  if (input.purpose === 'document-transcription') return `Transcribe all visible text from each of the ${input.imageUrls.length} document images as clean plain text. Preserve structure, do not summarize, and return exactly one ordered result per image. Score source legibility and quality from 1 to 100.`;
  if (input.purpose === 'document-reconciliation') return `Produce the best faithful transcription for each of the ${input.imageUrls.length} images. Compare the supplied primary and secondary text against each image, prefer the primary source on conflicts, repair clear OCR errors, and return exactly one ordered result per image. Score legibility and quality from 1 to 100.`;
  if (input.purpose === 'artwork-compliance') return `Inspect each of the ${input.imageUrls.length} images. An image is compliant only when it contains no person or human-like subject, no visible writing or text-like mark, and no botanical, fungal, or vegetation imagery. Use caption "compliant" and score 100 only when compliant; otherwise describe violations and score 1. Return one ordered result per image.`;
  return `Write one rich factual caption for each of the ${input.imageUrls.length} images, preserving order. Describe visible subjects, actions, setting, composition, colors, lighting, style, and readable text without speculation. Score image quality from 1 to 100.`;
}

const captionJsonSchema = { type: 'object', additionalProperties: false, required: ['results'], properties: { results: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['caption', 'score'], properties: { caption: { type: 'string' }, score: { type: 'integer', minimum: 1, maximum: 100 } } } } } };
async function executeStructured<TInput, TOutput>(fetcher: typeof fetch, config: z.output<typeof googleVertexProviderConfigSchema>, request: ProviderExecuteRequest<TInput>, body: Record<string, unknown>, parse: (value: unknown) => TOutput) {
  const raw = await requestVertex(fetcher, config, request.externalModelId, body, request);
  const candidate = raw.candidates?.[0];
  if (!candidate || candidate.finishReason !== 'STOP') throw new ProviderError(PROVIDER_ID, 'response_invalid', 'google-vertex structured response did not complete normally');
  const text = (candidate.content?.parts ?? []).map((part) => part.text ?? '').join('');
  let value: unknown;
  try { value = JSON.parse(text); } catch (error) { throw new ProviderError(PROVIDER_ID, 'response_invalid', 'google-vertex returned invalid structured JSON', { cause: error }); }
  return { output: parse(value), usage: tokenUsage(raw.usageMetadata?.promptTokenCount, raw.usageMetadata?.candidatesTokenCount, raw.usageMetadata?.totalTokenCount), providerId: PROVIDER_ID, modelId: request.modelId, externalModelId: request.externalModelId, rawResponse: raw };
}

async function captionImages<TInput, TOutput>(fetcher: typeof fetch, config: z.output<typeof googleVertexProviderConfigSchema>, request: ProviderExecuteRequest<TInput>): Promise<ProviderExecuteResponse<TOutput>> {
  const input = imageCaptionInputSchema.parse(request.input);
  const parts: VertexPart[] = [{ text: captionInstruction(input) }];
  input.imageUrls.forEach((url, index) => {
    parts.push({ text: `Image ${index + 1}:` });
    const references = input.referenceTexts?.[index];
    if (references) parts.push({ text: `Primary text:\n${references.primary}\n\nSecondary text:\n${references.secondary}` });
    parts.push(imagePart(url));
  });
  return executeStructured(fetcher, config, request, { contents: [{ role: 'user', parts }], generationConfig: { responseMimeType: 'application/json', responseSchema: captionJsonSchema } }, (value) => {
    const output = imageCaptionOutputSchema.parse(value);
    if (output.results.length !== input.imageUrls.length) throw new ProviderError(PROVIDER_ID, 'response_invalid', 'google-vertex image result count did not match the input count');
    return output as TOutput & ImageCaptionOutput;
  });
}

async function describeVisualIdentity<TInput, TOutput>(fetcher: typeof fetch, config: z.output<typeof googleVertexProviderConfigSchema>, request: ProviderExecuteRequest<TInput>): Promise<ProviderExecuteResponse<TOutput>> {
  const input = visualIdentityDescriptionInputSchema.parse(request.input);
  const parts: VertexPart[] = [{ text: 'The reference images show the same specific visual subject. Write one exhaustive factual recognition profile covering stable visible identifiers and distinguishing this exact subject from similar subjects. Exclude temporary context and unsupported guesses.' }];
  input.imageUrls.forEach((url, index) => parts.push({ text: `Reference image ${index + 1}:` }, imagePart(url)));
  const schema = { type: 'object', additionalProperties: false, required: ['description'], properties: { description: { type: 'string' } } };
  return executeStructured(fetcher, config, request, { contents: [{ role: 'user', parts }], generationConfig: { responseMimeType: 'application/json', responseSchema: schema } }, (value) => visualIdentityDescriptionOutputSchema.parse(value) as TOutput & VisualIdentityDescriptionOutput);
}

async function groundedSearch<TInput, TOutput>(fetcher: typeof fetch, config: z.output<typeof googleVertexProviderConfigSchema>, request: ProviderExecuteRequest<TInput>): Promise<ProviderExecuteResponse<TOutput>> {
  const input = webSearchInputSchema.omit({ mode: true }).parse(request.input);
  const generationConfig: Record<string, unknown> = {};
  if (input.responseFormat) { generationConfig.responseMimeType = 'application/json'; generationConfig.responseSchema = input.responseFormat.schema; }
  const raw = await requestVertex(fetcher, config, request.externalModelId, { contents: [{ role: 'user', parts: [{ text: input.prompt }] }], tools: [{ googleSearch: {} }], ...(Object.keys(generationConfig).length ? { generationConfig } : {}) }, request);
  const candidate = raw.candidates?.[0];
  if (!candidate || candidate.finishReason !== 'STOP') throw new ProviderError(PROVIDER_ID, 'response_invalid', 'google-vertex grounded search did not complete normally');
  const text = (candidate.content?.parts ?? []).map((part) => part.text ?? '').join('').trim();
  const metadata = candidate.groundingMetadata;
  const seen = new Set<string>();
  const citations = (metadata?.groundingChunks ?? []).flatMap(({ web }) => {
    if (!web?.uri || seen.has(web.uri)) return [];
    let parsed: URL;
    try { parsed = new URL(web.uri); } catch { return []; }
    if (parsed.protocol !== 'https:') return [];
    seen.add(web.uri);
    return [{ title: web.title?.trim() || parsed.hostname, url: web.uri }];
  });
  if (!text || !(metadata?.webSearchQueries?.length) || citations.length === 0) throw new ProviderError(PROVIDER_ID, 'response_invalid', 'google-vertex returned no grounded search evidence');
  const output = webSearchOutputSchema.parse({ text, citations, sources: citations.map(({ url }) => url) });
  return { output: output as TOutput & WebSearchOutput, usage: tokenUsage(raw.usageMetadata?.promptTokenCount, raw.usageMetadata?.candidatesTokenCount, raw.usageMetadata?.totalTokenCount), providerId: PROVIDER_ID, modelId: request.modelId, externalModelId: request.externalModelId, rawResponse: raw };
}

const ratioBySize = { '1024x1024': '1:1', '1024x1536': '2:3', '1536x1024': '3:2' } as const;
const dimensionsBySize = { '1024x1024': [1024, 1024], '1024x1536': [1024, 1536], '1536x1024': [1536, 1024] } as const;
async function normalizeGeneratedImage(part: z.infer<typeof partSchema>, input: ImageGenerateInput) {
  if (!part.inlineData) throw new ProviderError(PROVIDER_ID, 'response_invalid', 'google-vertex returned no generated image');
  let bytes: Uint8Array = Buffer.from(part.inlineData.data, 'base64');
  const format = input.outputFormat ?? (part.inlineData.mimeType === 'image/jpeg' ? 'jpeg' : part.inlineData.mimeType === 'image/webp' ? 'webp' : 'png');
  const pipeline = sharp(bytes);
  if (input.size) { const [width, height] = dimensionsBySize[input.size]; pipeline.resize(width, height, { fit: 'fill' }); }
  bytes = await (format === 'jpeg' ? pipeline.jpeg() : format === 'webp' ? pipeline.webp() : pipeline.png()).toBuffer();
  return { base64: Buffer.from(bytes).toString('base64'), mimeType: `image/${format}` as 'image/png' | 'image/jpeg' | 'image/webp' };
}

async function generateImages<TInput, TOutput>(fetcher: typeof fetch, config: z.output<typeof googleVertexProviderConfigSchema>, request: ProviderExecuteRequest<TInput>): Promise<ProviderExecuteResponse<TOutput>> {
  const input = imageGenerateInputSchema.parse(request.input);
  if (input.resolution && input.resolution !== '1K') throw new ProviderError(PROVIDER_ID, 'invalid_input', 'Gemini 3.1 Flash-Lite Image supports only 1K output');
  const aspectRatio = input.aspectRatio ?? (input.size ? ratioBySize[input.size] : undefined);
  const responses = await Promise.all(Array.from({ length: input.count }, () => requestVertex(fetcher, config, request.externalModelId, {
    contents: [{ role: 'user', parts: [{ text: input.prompt }] }],
    generationConfig: { responseModalities: ['IMAGE'], imageConfig: { ...(aspectRatio ? { aspectRatio } : {}) } },
  }, request)));
  const images = await Promise.all(responses.map(async (raw) => {
    const candidate = raw.candidates?.[0];
    if (!candidate || candidate.finishReason !== 'STOP') throw new ProviderError(PROVIDER_ID, 'response_invalid', 'google-vertex image generation did not complete normally');
    const part = candidate.content?.parts?.find((item) => item.inlineData);
    if (!part) throw new ProviderError(PROVIDER_ID, 'response_invalid', 'google-vertex returned no image data');
    return normalizeGeneratedImage(part, input);
  }));
  const output: ImageOutput = imageOutputSchema.parse({ images });
  const usage = tokenUsage(
    responses.reduce((sum, raw) => sum + (raw.usageMetadata?.promptTokenCount ?? 0), 0),
    responses.reduce((sum, raw) => sum + (raw.usageMetadata?.candidatesTokenCount ?? 0), 0),
    responses.reduce((sum, raw) => sum + (raw.usageMetadata?.totalTokenCount ?? 0), 0),
  );
  return { output: output as TOutput, usage, providerId: PROVIDER_ID, modelId: request.modelId, externalModelId: request.externalModelId, rawResponse: responses };
}

async function* streamChat<TInput>(fetcher: typeof fetch, config: z.output<typeof googleVertexProviderConfigSchema>, request: ProviderExecuteRequest<TInput>): AsyncIterable<ProviderStreamChunk> {
  const target = endpoint(config, request.externalModelId, 'streamGenerateContent');
  const response = await fetcher(target.url, { method: 'POST', headers: target.headers, body: JSON.stringify(buildChatBody(chatInputSchema.parse(request.input))), signal: resolveRequestSignal(request) });
  if (!response.ok) throw new ProviderError(PROVIDER_ID, providerErrorCodeForStatus(response.status), `google-vertex stream failed with status ${response.status}`, { status: response.status });
  if (!response.body) throw new ProviderError(PROVIDER_ID, 'response_invalid', 'google-vertex returned no stream body');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let completed = false;
  let sawContent = false;
  while (true) {
    const { done, value } = await reader.read();
    buffer += decoder.decode(value, { stream: !done });
    const events = buffer.split(/\r?\n\r?\n/);
    buffer = events.pop() ?? '';
    for (const event of events) {
      const data = event.split(/\r?\n/).filter((line) => line.startsWith('data:')).map((line) => line.slice(5).trim()).join('');
      if (!data || data === '[DONE]') continue;
      const raw = responseSchema.parse(JSON.parse(data));
      const candidate = raw.candidates?.[0];
      for (const part of candidate?.content?.parts ?? []) if (part.text) { sawContent = true; yield { type: 'text-delta', text: part.text }; }
      if (raw.usageMetadata) yield { type: 'usage', usage: tokenUsage(raw.usageMetadata.promptTokenCount, raw.usageMetadata.candidatesTokenCount, raw.usageMetadata.totalTokenCount) };
      if (candidate?.finishReason) {
        if (!['STOP', 'MAX_TOKENS'].includes(candidate.finishReason)) throw new ProviderError(PROVIDER_ID, 'response_invalid', `google-vertex stream ended with ${candidate.finishReason}`);
        completed = true;
      }
    }
    if (done) break;
  }
  if (!completed || !sawContent) throw new ProviderError(PROVIDER_ID, 'response_invalid', 'google-vertex stream ended without completed text');
  yield { type: 'done' };
}

export function createGoogleVertexProvider(config: GoogleVertexProviderConfig, fetcher: typeof fetch = fetch): ProviderAdapter {
  const parsed = googleVertexProviderConfigSchema.parse(config);
  return {
    id: PROVIDER_ID,
    name: 'Google Vertex AI',
    async execute<TInput, TOutput>(request: ProviderExecuteRequest<TInput>) {
      try {
        if (request.actionId === 'ask') return await executeChat<TInput, TOutput>(fetcher, parsed, request);
        if (request.actionId === 'caption-image') return await captionImages<TInput, TOutput>(fetcher, parsed, request);
        if (request.actionId === 'describe-visual-identity') return await describeVisualIdentity<TInput, TOutput>(fetcher, parsed, request);
        if (request.actionId === 'web-search') return await groundedSearch<TInput, TOutput>(fetcher, parsed, request);
        if (request.actionId === 'generate-image') return await generateImages<TInput, TOutput>(fetcher, parsed, request);
        throw new ProviderError(PROVIDER_ID, 'unsupported_action', `google-vertex does not implement action ${request.actionId}`);
      } catch (error) { throw normalizeProviderError(PROVIDER_ID, error); }
    },
    stream(request) {
      if (request.actionId !== 'ask') throw new ProviderError(PROVIDER_ID, 'unsupported_action', `google-vertex does not stream action ${request.actionId}`);
      return streamChat(fetcher, parsed, request);
    },
  };
}

export const googleVertexProviderFactory: ProviderFactory = {
  id: PROVIDER_ID,
  configSchema: googleVertexProviderConfigSchema,
  create(config) { return createGoogleVertexProvider(googleVertexProviderConfigSchema.parse(config)); },
};
