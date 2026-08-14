import { describe, expect, test } from 'bun:test';
import { Hono } from 'hono';
import { newId } from '@/lib/ids';
import { ContentError } from '@/lib/ai/tools';
import { postAudioGenerate } from './audio';

describe('audio generation API', () => {
  test('requires authentication before generation', async () => {
    const app = new Hono();
    app.post('/audio/generate', (context) => postAudioGenerate(context, { getIdentity: async () => null }));
    expect((await app.request('/audio/generate', { method: 'POST', body: '{}' })).status).toBe(401);
  });

  test('rejects non-user identities', async () => {
    const app = new Hono();
    app.post('/audio/generate', (context) => postAudioGenerate(context, { getIdentity: async () => ({ key: newId(), identityType: 'service' }) as never }));
    expect((await app.request('/audio/generate', { method: 'POST', body: '{}' })).status).toBe(403);
  });

  test('authorizes the agent and streams completed MP3 chunks in order', async () => {
    const organizationKey = newId();
    const agentKey = newId();
    const userKey = newId();
    const calls: unknown[] = [];
    const app = new Hono();
    app.post('/audio/generate', (context) => postAudioGenerate(context, {
      getIdentity: async () => ({ key: userKey, identityType: 'user' }) as never,
      authorize: async (input, options) => { calls.push({ input, authenticatedUserKey: options.authenticatedUserKey }); return {} as never; },
      generate: async function* (_input, dependencies) {
        expect(dependencies).toMatchObject({ organizationKey });
        yield { index: 0, startWord: 0, endWord: 20, startCharacter: 0, endCharacter: 100, audioBase64: 'Zmlyc3Q=', mimeType: 'audio/mpeg' };
        yield { index: 1, startWord: 20, endWord: 21, startCharacter: 101, endCharacter: 105, audioBase64: 'c2Vjb25k', mimeType: 'audio/mpeg' };
      },
    }));
    const response = await app.request('/audio/generate', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ organizationKey, agentKey, input: { text: Array.from({ length: 21 }, () => 'word').join(' '), wordsPerChunk: 20 } }) });
    const body = await response.text();
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/event-stream');
    expect(body).toContain('event: start');
    expect(body.match(/event: chunk/g)).toHaveLength(2);
    expect(body.indexOf('"index":0')).toBeLessThan(body.indexOf('"index":1'));
    expect(body).toContain('event: done');
    expect(calls).toEqual([{ input: { organizationKey, agentKey }, authenticatedUserKey: userKey }]);
  });

  test('does not start generation when agent authorization fails', async () => {
    let generated = false;
    const app = new Hono();
    app.post('/audio/generate', (context) => postAudioGenerate(context, {
      getIdentity: async () => ({ key: newId(), identityType: 'user' }) as never,
      authorize: async () => { throw new ContentError('CONTENT_FORBIDDEN', 'Denied.', 'audio.generate'); },
      generate: async function* () { generated = true; yield {} as never; },
    }));
    const response = await app.request('/audio/generate', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ organizationKey: newId(), agentKey: newId(), input: { text: 'Read this document.' } }) });
    expect(response.status).toBe(403);
    expect(generated).toBe(false);
  });

  test('reports a terminal stream error after preserving completed chunks', async () => {
    const app = new Hono();
    app.post('/audio/generate', (context) => postAudioGenerate(context, {
      getIdentity: async () => ({ key: newId(), identityType: 'user' }) as never,
      authorize: async () => ({} as never),
      generate: async function* () {
        yield { index: 0, startWord: 0, endWord: 3, startCharacter: 0, endCharacter: 14, audioBase64: 'bXAz', mimeType: 'audio/mpeg' };
        throw new Error('provider failed');
      },
    }));
    const response = await app.request('/audio/generate', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ organizationKey: newId(), agentKey: newId(), input: { text: 'Read this document.' } }) });
    const body = await response.text();
    expect(body).toContain('event: chunk');
    expect(body).toContain('event: error');
    expect(body).toContain('"completed":1');
  });
});
