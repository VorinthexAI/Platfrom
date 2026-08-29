import { describe, expect, test } from 'bun:test';
import { createGoogleVertexProvider } from './google-vertex';
import type { ProviderExecuteRequest } from './types';

function request(actionId: ProviderExecuteRequest['actionId'], input: unknown): ProviderExecuteRequest {
  return { actionId, modelId: 'google.gemini-3.7-flash', externalModelId: 'gemini-3.7-flash', input, organizationKey: 'org' };
}

describe('Google Vertex provider', () => {
  test('uses the global Vertex endpoint and preserves tool thought signatures', async () => {
    let receivedUrl = '';
    let receivedBody: any;
    const fetcher = (async (url: string | URL | Request, init?: RequestInit) => {
      receivedUrl = String(url);
      receivedBody = JSON.parse(String(init?.body));
      return Response.json({
        candidates: [{ content: { parts: [{ functionCall: { id: 'call-2', name: 'weather', args: { city: 'Oslo' } }, thoughtSignature: 'signed-state' }] }, finishReason: 'STOP' }],
        usageMetadata: { promptTokenCount: 4, candidatesTokenCount: 3, totalTokenCount: 7 },
      });
    }) as typeof fetch;
    const provider = createGoogleVertexProvider({ accessToken: 'token', projectId: 'project', location: 'global' }, fetcher);

    const result = await provider.execute(request('ask', {
      messages: [
        { role: 'assistant', content: [{ type: 'tool-call', toolCallId: 'call-1', name: 'weather', arguments: { city: 'Paris' }, opaqueState: 'prior-state' }] },
        { role: 'tool', content: [{ type: 'tool-result', toolCallId: 'call-1', result: { temperature: 18 } }] },
      ],
      tools: [{ name: 'weather', description: 'Get weather', inputSchema: { type: 'object' } }],
    }));

    expect(receivedUrl).toBe('https://aiplatform.googleapis.com/v1/projects/project/locations/global/publishers/google/models/gemini-3.7-flash:generateContent');
    expect(receivedBody.contents[0].parts[0]).toEqual({ functionCall: { id: 'call-1', name: 'weather', args: { city: 'Paris' } }, thoughtSignature: 'prior-state' });
    expect(receivedBody.contents[1].parts[0]).toEqual({ functionResponse: { id: 'call-1', name: 'weather', response: { output: { temperature: 18 } } } });
    expect(result.output).toEqual({ text: '', toolCalls: [{ id: 'call-2', name: 'weather', arguments: { city: 'Oslo' }, opaqueState: 'signed-state' }], stopReason: 'tool_use' });
    expect(result.usage.totalTokens).toBe(7);
  });

  test('sends inline images and validates structured caption results', async () => {
    let receivedUrl = '';
    let receivedHeaders: Headers;
    let receivedBody: any;
    const fetcher = (async (url: string | URL | Request, init?: RequestInit) => {
      receivedUrl = String(url);
      receivedHeaders = new Headers(init?.headers);
      receivedBody = JSON.parse(String(init?.body));
      return Response.json({ candidates: [{ content: { parts: [{ text: '{"results":[{"caption":"A red square","score":90}]}' }] }, finishReason: 'STOP' }] });
    }) as typeof fetch;
    const provider = createGoogleVertexProvider({ apiKey: 'key' }, fetcher);
    const result = await provider.execute(request('caption-image', { imageUrls: ['data:image/png;base64,aW1hZ2U='], purpose: 'caption' }));

    expect(receivedUrl).not.toContain('key=');
    expect(receivedHeaders!.get('x-goog-api-key')).toBe('key');
    expect(receivedBody.contents[0].parts[2]).toEqual({ inlineData: { mimeType: 'image/png', data: 'aW1hZ2U=' } });
    expect(receivedBody.generationConfig.responseMimeType).toBe('application/json');
    expect(result.output).toEqual({ results: [{ caption: 'A red square', score: 90 }] });
  });

  test('accepts token-limited streaming text', async () => {
    const body = 'data: {"candidates":[{"content":{"parts":[{"text":"Partial answer"}]},"finishReason":"MAX_TOKENS"}]}\n\n';
    const fetcher = (async () => new Response(body, { headers: { 'content-type': 'text/event-stream' } })) as unknown as typeof fetch;
    const provider = createGoogleVertexProvider({ apiKey: 'key' }, fetcher);
    const chunks = [];
    for await (const chunk of provider.stream!(request('ask', { messages: [{ role: 'user', content: [{ type: 'text', text: 'Hello' }] }] }))) chunks.push(chunk);
    expect(chunks).toEqual([{ type: 'text-delta', text: 'Partial answer' }, { type: 'done' }]);
  });

  test('requires grounded search evidence', async () => {
    const fetcher = (async () => Response.json({ candidates: [{ content: { parts: [{ text: 'Current answer' }] }, finishReason: 'STOP', groundingMetadata: { webSearchQueries: ['query'], groundingChunks: [{ web: { uri: 'https://example.com/source', title: 'Source' } }] } }] })) as unknown as typeof fetch;
    const provider = createGoogleVertexProvider({ apiKey: 'key' }, fetcher);
    const result = await provider.execute(request('web-search', { prompt: 'What changed?' }));
    expect(result.output).toEqual({ text: 'Current answer', citations: [{ title: 'Source', url: 'https://example.com/source' }], sources: ['https://example.com/source'] });
  });

  test('fans out image candidates and requests the selected aspect ratio', async () => {
    const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
    const bodies: any[] = [];
    const fetcher = (async (_url: string | URL | Request, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body)));
      return Response.json({ candidates: [{ content: { parts: [{ inlineData: { mimeType: 'image/png', data: png } }] }, finishReason: 'STOP' }] });
    }) as typeof fetch;
    const provider = createGoogleVertexProvider({ apiKey: 'key' }, fetcher);
    const result = await provider.execute(request('generate-image', { prompt: 'A compass', count: 2, aspectRatio: '3:2', outputFormat: 'png' }));

    expect(bodies).toHaveLength(2);
    expect(bodies[0].generationConfig).toEqual({ responseModalities: ['IMAGE'], imageConfig: { aspectRatio: '3:2' } });
    expect((result.output as { images: unknown[] }).images).toHaveLength(2);
  });

});
