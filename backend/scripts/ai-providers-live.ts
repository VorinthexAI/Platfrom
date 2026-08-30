#!/usr/bin/env bun
import sharp from 'sharp';
import { createOpenRouterProvider } from '@/lib/ai/providers/openrouter';

const apiKey = process.env.OPENROUTER_API_KEY?.trim();
if (!apiKey) throw new Error('OPENROUTER_API_KEY is required.');

const provider = createOpenRouterProvider({ apiKey });
const results: Array<{ capability: string; status: 'passed' | 'failed'; durationMs: number; detail: string }> = [];
const textModel = { modelId: 'google.gemini-3.1-flash-lite-preview', externalModelId: 'google/gemini-3.1-flash-lite-preview' } as const;
const imageModel = { modelId: 'google.gemini-3.1-flash-lite-image', externalModelId: 'google/gemini-3.1-flash-lite-image' } as const;

async function verify(capability: string, run: () => Promise<string>) {
  const startedAt = performance.now();
  try {
    const detail = await run();
    results.push({ capability, status: 'passed', durationMs: Math.round(performance.now() - startedAt), detail });
  } catch (error) {
    results.push({ capability, status: 'failed', durationMs: Math.round(performance.now() - startedAt), detail: error instanceof Error ? error.message : String(error) });
  }
}

const executeText = (input: unknown) => provider.execute({ actionId: 'text', ...textModel, organizationKey: 'live-smoke', input, timeoutMs: 120_000 });

await verify('Text generation', async () => {
  const response = await executeText({ messages: [{ role: 'user', content: [{ type: 'text', text: 'Reply with exactly: openrouter-ok' }] }], options: { temperature: 0, maxTokens: 64 } });
  const text = (response.output as { text: string }).text.trim().toLowerCase();
  if (!text.includes('openrouter-ok')) throw new Error(`Unexpected text response: ${text}`);
  return `${response.usage.totalTokens} tokens`;
});

await verify('Structured output', async () => {
  const response = await executeText({
    messages: [{ role: 'user', content: [{ type: 'text', text: 'Return a health status.' }] }],
    responseFormat: { name: 'health_status', schema: { type: 'object', additionalProperties: false, required: ['status'], properties: { status: { type: 'string', enum: ['ok'] } } } },
    options: { temperature: 0, maxTokens: 64 },
  });
  const parsed = JSON.parse((response.output as { text: string }).text) as { status?: string };
  if (parsed.status !== 'ok') throw new Error('Structured output did not match the requested schema.');
  return 'schema valid';
});

let toolCall: { id: string; name: string; arguments: unknown } | undefined;
await verify('Tool call', async () => {
  const response = await executeText({
    messages: [{ role: 'user', content: [{ type: 'text', text: 'Use add_numbers to add 17 and 25. You must call the tool.' }] }],
    tools: [{ name: 'add_numbers', description: 'Add two numbers.', inputSchema: { type: 'object', additionalProperties: false, required: ['left', 'right'], properties: { left: { type: 'number' }, right: { type: 'number' } } } }],
    options: { temperature: 0, maxTokens: 128 },
  });
  toolCall = (response.output as { toolCalls: typeof toolCall[] }).toolCalls[0];
  if (!toolCall || toolCall.name !== 'add_numbers') throw new Error('OpenRouter did not return the required tool call.');
  return 'call valid';
});

await verify('Tool continuation', async () => {
  if (!toolCall) throw new Error('Tool call unavailable.');
  const response = await executeText({
    messages: [
      { role: 'user', content: [{ type: 'text', text: 'Use add_numbers to add 17 and 25. You must call the tool.' }] },
      { role: 'assistant', content: [{ type: 'tool-call', toolCallId: toolCall.id, name: toolCall.name, arguments: toolCall.arguments }] },
      { role: 'tool', content: [{ type: 'tool-result', toolCallId: toolCall.id, result: { value: 42 } }] },
    ],
    tools: [{ name: 'add_numbers', description: 'Add two numbers.', inputSchema: { type: 'object', additionalProperties: false, required: ['left', 'right'], properties: { left: { type: 'number' }, right: { type: 'number' } } } }],
    options: { temperature: 0, maxTokens: 64 },
  });
  const text = (response.output as { text: string }).text;
  if (!text.includes('42')) throw new Error(`Tool continuation omitted the result: ${text}`);
  return 'result accepted';
});

await verify('Text streaming', async () => {
  if (!provider.stream) throw new Error('OpenRouter streaming is unavailable.');
  let text = '';
  let completed = false;
  for await (const chunk of provider.stream({ actionId: 'text', ...textModel, organizationKey: 'live-smoke', input: { messages: [{ role: 'user', content: [{ type: 'text', text: 'Reply with exactly: stream-ok' }] }], options: { temperature: 0, maxTokens: 64 } }, timeoutMs: 120_000 })) {
    if (chunk.type === 'text-delta') text += chunk.text;
    if (chunk.type === 'done') completed = true;
  }
  if (!completed || !text.toLowerCase().includes('stream-ok')) throw new Error(`Unexpected stream response: ${text}`);
  return 'stream completed';
});

await verify('Grounded web search', async () => {
  const response = await provider.execute({ actionId: 'web', ...textModel, organizationKey: 'live-smoke', input: { prompt: 'What is the official capital of Sweden? Answer briefly and cite a source.' }, timeoutMs: 120_000 });
  const output = response.output as { text: string; citations: unknown[] };
  if (!output.text.toLowerCase().includes('stockholm') || output.citations.length === 0) throw new Error('Grounded search returned no supported answer.');
  return `${output.citations.length} citation(s)`;
});

const sourceImage = await sharp({ create: { width: 64, height: 64, channels: 3, background: '#d7263d' } }).png().toBuffer();
const imageUrl = `data:image/png;base64,${sourceImage.toString('base64')}`;

await verify('Image caption', async () => {
  const response = await provider.execute({ actionId: 'image', ...imageModel, organizationKey: 'live-smoke', input: { operation: 'caption', imageUrls: [imageUrl], purpose: 'caption' }, timeoutMs: 120_000 });
  const output = response.output as { results: Array<{ caption: string }> };
  if (output.results.length !== 1 || !output.results[0]?.caption) throw new Error('Image caption returned no result.');
  return 'caption valid';
});

await verify('Visual identity', async () => {
  const response = await provider.execute({ actionId: 'image', ...imageModel, organizationKey: 'live-smoke', input: { operation: 'describe-visual-identity', imageUrls: [imageUrl] }, timeoutMs: 120_000 });
  const output = response.output as { description: string };
  if (!output.description) throw new Error('Visual identity returned no description.');
  return 'description valid';
});

await verify('Image generation', async () => {
  const response = await provider.execute({ actionId: 'image', ...imageModel, organizationKey: 'live-smoke', input: { operation: 'generate', prompt: 'A minimal red compass icon centered on a plain white background.', count: 1, aspectRatio: '1:1', outputFormat: 'png' }, timeoutMs: 180_000 });
  const output = response.output as { images: Array<{ base64: string; mimeType: string }> };
  if (output.images.length !== 1 || !output.images[0]?.base64) throw new Error('Image generation returned no image.');
  return `${Buffer.from(output.images[0].base64, 'base64').length} bytes`;
});

await verify('Speech generation', async () => {
  const response = await provider.execute({ actionId: 'speech', modelId: 'xai.grok-voice-tts-1.0', externalModelId: 'x-ai/grok-voice-tts-1.0', organizationKey: 'live-smoke', input: { text: 'Vorinthex speech capability is operational.', language: 'English', voice: 'coral', pace: 1, format: 'mp3' }, timeoutMs: 180_000 });
  const output = response.output as { base64: string; durationSeconds: number };
  const mp3 = Buffer.from(output.base64, 'base64');
  if (!mp3.length || !output.durationSeconds || mp3[0] !== 0xff) throw new Error('Speech generation returned no valid MP3 audio.');
  return `${output.durationSeconds}s, ${mp3.length} MP3 bytes`;
});

await verify('Embeddings', async () => {
  if (!provider.embed) throw new Error('OpenRouter embedding adapter is unavailable.');
  const response = await provider.embed({ externalModelId: 'openai/text-embedding-3-small', input: ['first smoke vector', 'second smoke vector'], dimensions: 1_536, timeoutMs: 120_000 });
  if (response.embeddings.length !== 2 || response.embeddings.some((embedding) => embedding.length !== 1_536)) throw new Error('OpenRouter returned invalid embedding dimensions.');
  return `2 vectors, ${response.usage.totalTokens} tokens`;
});

console.table(results);
const failures = results.filter(({ status }) => status === 'failed');
console.log(`Verified ${results.length - failures.length}/${results.length} live OpenRouter capabilities.`);
if (failures.length) throw new Error(`OpenRouter live verification failed: ${failures.map(({ capability }) => capability).join(', ')}`);
