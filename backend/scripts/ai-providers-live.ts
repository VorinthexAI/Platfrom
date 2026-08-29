#!/usr/bin/env bun
import sharp from 'sharp';
import { createAwsPollyProvider } from '@/lib/ai/providers/aws-polly';
import { createAzureAIFoundryProvider } from '@/lib/ai/providers/azure-ai-foundry';
import { createGoogleVertexProvider } from '@/lib/ai/providers/google-vertex';

const googleApiKey = process.env.GOOGLE_VERTEX_API_KEY;
const googleProjectId = process.env.GOOGLE_VERTEX_PROJECT_ID;
const azureApiKey = process.env.AZURE_OPENAI_API_KEY;
const azureEndpoint = process.env.AZURE_OPENAI_ENDPOINT;
if (!googleApiKey || !googleProjectId || !azureApiKey || !azureEndpoint) throw new Error('Google Vertex and Azure OpenAI credentials are required.');

const vertex = createGoogleVertexProvider({ apiKey: googleApiKey, projectId: googleProjectId });
const azure = createAzureAIFoundryProvider({ apiKey: azureApiKey, endpoint: azureEndpoint });
const polly = createAwsPollyProvider({
  region: process.env.AWS_POLLY_REGION ?? 'eu-central-1',
  ...(process.env.AWS_POLLY_ENDPOINT ? { endpoint: process.env.AWS_POLLY_ENDPOINT } : {}),
  ...(process.env.AWS_POLLY_PROFILE ? { profile: process.env.AWS_POLLY_PROFILE } : {}),
});
const results: Array<{ capability: string; durationMs: number; detail: string }> = [];

async function verify(capability: string, run: () => Promise<string>) {
  const startedAt = performance.now();
  const detail = await run();
  results.push({ capability, durationMs: Math.round(performance.now() - startedAt), detail });
}

const vertexRequest = (actionId: 'ask' | 'web-search' | 'caption-image' | 'describe-visual-identity', input: unknown) => vertex.execute({
  actionId,
  modelId: actionId === 'ask' ? 'google.gemini-3.5-flash-lite' : 'google.gemini-3.7-flash',
  externalModelId: actionId === 'ask' ? 'gemini-3.5-flash-lite' : 'gemini-3.7-flash',
  organizationKey: 'live-smoke',
  input,
  timeoutMs: 120_000,
});

await verify('Vertex text generation', async () => {
  const response = await vertexRequest('ask', { messages: [{ role: 'user', content: [{ type: 'text', text: 'Reply with exactly: vertex-ok' }] }], options: { temperature: 0, maxTokens: 256 } });
  const text = (response.output as { text: string }).text.trim().toLowerCase();
  if (!text.includes('vertex-ok')) throw new Error(`Unexpected Vertex text response: ${text}`);
  return `${response.usage.totalTokens} tokens`;
});

await verify('Vertex structured output', async () => {
  const response = await vertexRequest('ask', {
    messages: [{ role: 'user', content: [{ type: 'text', text: 'Return a health status.' }] }],
    responseFormat: { name: 'health_status', schema: { type: 'object', additionalProperties: false, required: ['status'], properties: { status: { type: 'string', enum: ['ok'] } } } },
    options: { temperature: 0, maxTokens: 256 },
  });
  const parsed = JSON.parse((response.output as { text: string }).text) as { status?: string };
  if (parsed.status !== 'ok') throw new Error('Vertex structured output did not match the requested schema.');
  return 'schema valid';
});

let toolCall: { id: string; name: string; arguments: unknown; opaqueState?: string } | undefined;
await verify('Vertex tool call', async () => {
  const response = await vertexRequest('ask', {
    messages: [{ role: 'user', content: [{ type: 'text', text: 'Use add_numbers to add 17 and 25. You must call the tool.' }] }],
    tools: [{ name: 'add_numbers', description: 'Add two numbers.', inputSchema: { type: 'object', additionalProperties: false, required: ['left', 'right'], properties: { left: { type: 'number' }, right: { type: 'number' } } } }],
    options: { temperature: 0, maxTokens: 512 },
  });
  toolCall = (response.output as { toolCalls: typeof toolCall[] }).toolCalls[0];
  if (!toolCall || toolCall.name !== 'add_numbers') throw new Error('Vertex did not return the required tool call.');
  return toolCall.opaqueState ? 'call with thought signature' : 'call';
});

await verify('Vertex tool continuation', async () => {
  if (!toolCall) throw new Error('Tool call unavailable.');
  const response = await vertexRequest('ask', {
    messages: [
      { role: 'user', content: [{ type: 'text', text: 'Use add_numbers to add 17 and 25. You must call the tool.' }] },
      { role: 'assistant', content: [{ type: 'tool-call', toolCallId: toolCall.id, name: toolCall.name, arguments: toolCall.arguments, ...(toolCall.opaqueState ? { opaqueState: toolCall.opaqueState } : {}) }] },
      { role: 'tool', content: [{ type: 'tool-result', toolCallId: toolCall.id, result: { value: 42 } }] },
    ],
    tools: [{ name: 'add_numbers', description: 'Add two numbers.', inputSchema: { type: 'object', additionalProperties: false, required: ['left', 'right'], properties: { left: { type: 'number' }, right: { type: 'number' } } } }],
    options: { temperature: 0, maxTokens: 256 },
  });
  const text = (response.output as { text: string }).text;
  if (!text.includes('42')) throw new Error(`Vertex tool continuation omitted the result: ${text}`);
  return 'result accepted';
});

await verify('Vertex streaming', async () => {
  if (!vertex.stream) throw new Error('Vertex streaming is unavailable.');
  let text = '';
  let completed = false;
  for await (const chunk of vertex.stream({ actionId: 'ask', modelId: 'google.gemini-3.5-flash-lite', externalModelId: 'gemini-3.5-flash-lite', organizationKey: 'live-smoke', input: { messages: [{ role: 'user', content: [{ type: 'text', text: 'Reply with exactly: stream-ok' }] }], options: { temperature: 0, maxTokens: 256 } }, timeoutMs: 120_000 })) {
    if (chunk.type === 'text-delta') text += chunk.text;
    if (chunk.type === 'done') completed = true;
  }
  if (!completed || !text.toLowerCase().includes('stream-ok')) throw new Error(`Unexpected Vertex stream response: ${text}`);
  return 'stream completed';
});

await verify('Vertex grounded search', async () => {
  const response = await vertexRequest('web-search', { prompt: 'What is the official capital of Sweden? Answer briefly and cite a source.' });
  const output = response.output as { text: string; citations: unknown[] };
  if (!output.text.toLowerCase().includes('stockholm') || output.citations.length === 0) throw new Error('Vertex grounded search returned no supported answer.');
  return `${output.citations.length} citation(s)`;
});

const image = await sharp({ create: { width: 64, height: 64, channels: 3, background: '#d7263d' } }).png().toBuffer();
const imageUrl = `data:image/png;base64,${image.toString('base64')}`;
await verify('Vertex image caption', async () => {
  const response = await vertexRequest('caption-image', { imageUrls: [imageUrl], purpose: 'caption' });
  const output = response.output as { results: Array<{ caption: string }> };
  if (output.results.length !== 1 || !output.results[0]?.caption) throw new Error('Vertex image caption returned no result.');
  return 'caption valid';
});

await verify('Vertex visual identity', async () => {
  const response = await vertexRequest('describe-visual-identity', { imageUrls: [imageUrl] });
  const output = response.output as { description: string };
  if (!output.description) throw new Error('Vertex visual identity returned no description.');
  return 'description valid';
});

await verify('Vertex image generation', async () => {
  const response = await vertex.execute({ actionId: 'generate-image', modelId: 'google.gemini-3.1-flash-lite-image', externalModelId: 'gemini-3.1-flash-lite-image', organizationKey: 'live-smoke', input: { prompt: 'A minimal red compass icon centered on a plain white background.', count: 1, aspectRatio: '1:1', outputFormat: 'png' }, timeoutMs: 180_000 });
  const output = response.output as { images: Array<{ base64: string; mimeType: string }> };
  if (output.images.length !== 1 || output.images[0]?.mimeType !== 'image/png') throw new Error('Vertex image generation returned no PNG.');
  return `${Buffer.from(output.images[0].base64, 'base64').length} bytes`;
});

await verify('Amazon Polly speech generation', async () => {
  const response = await polly.execute({ actionId: 'generate-speech', modelId: 'amazon.polly-neural', externalModelId: 'neural', organizationKey: 'live-smoke', input: { text: 'Vorinthex speech capability is operational.', voice: 'coral', pace: 1, format: 'mp3' }, timeoutMs: 180_000 });
  const output = response.output as { base64: string; durationSeconds: number };
  const mp3 = Buffer.from(output.base64, 'base64');
  if (!mp3.length || !output.durationSeconds || mp3[0] !== 0xff) throw new Error('Amazon Polly returned no valid MP3 audio.');
  return `${output.durationSeconds}s, ${mp3.length} MP3 bytes`;
});

await verify('Azure embeddings', async () => {
  if (!azure.embed) throw new Error('Azure embedding adapter is unavailable.');
  const response = await azure.embed({ externalModelId: 'text-embedding-3-small', input: ['first smoke vector', 'second smoke vector'], dimensions: 1_536, timeoutMs: 120_000 });
  if (response.embeddings.length !== 2 || response.embeddings.some((embedding) => embedding.length !== 1_536)) throw new Error('Azure returned invalid embedding dimensions.');
  return `2 vectors, ${response.usage.totalTokens} tokens`;
});

console.table(results);
console.log(`Verified ${results.length} live AI capabilities.`);
