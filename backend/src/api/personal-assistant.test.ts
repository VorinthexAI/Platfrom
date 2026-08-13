import { describe, expect, test } from 'bun:test';
import { Hono } from 'hono';
import { newId } from '@/lib/ids';
import { createPersonalAssistantHandler } from './personal-assistant';

const organizationKey = newId();
const agentKey = newId();
const requestBody = {
  organizationKey,
  agentKey,
  input: { surface: 'knowledge-workspace', message: 'Improve this', currentNote: { title: 'Draft', content: 'Text' } },
};

function request(dependencies: Parameters<typeof createPersonalAssistantHandler>[0], body: unknown = requestBody) {
  const app = new Hono();
  app.post('/assistant/respond', createPersonalAssistantHandler(dependencies));
  return app.request('/assistant/respond', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
}

describe('personal assistant API', () => {
  test('requires an authenticated user session', async () => {
    const response = await request({ getIdentity: async () => null });
    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ success: false, error: { code: 'ASSISTANT_UNAUTHORIZED' } });
  });

  test('authorizes the agent and returns structured assistant output', async () => {
    let authorization: unknown;
    const context = { organizationKey, runtimeScopeKey: newId(), principal: {} } as any;
    const response = await request({
      getIdentity: async () => ({ key: newId(), identityType: 'user' }),
      authorize: async (input) => { authorization = input; return { input: input as any, context }; },
      run: async () => ({ type: 'note', content: 'Improved text', message: 'Improved the note.', sources: [] }),
    });
    expect(response.status).toBe(200);
    expect(authorization).toEqual({ organizationKey, agentKey });
    expect(await response.json()).toEqual({ success: true, data: { type: 'note', content: 'Improved text', message: 'Improved the note.', sources: [] } });
  });

  test('authorizes media workspace execution against image search', async () => {
    let authorization: unknown;
    const response = await request({
      getIdentity: async () => ({ key: newId(), identityType: 'user' }),
      authorize: async (input) => { authorization = input; return { input: input as any, context: { organizationKey, runtimeScopeKey: newId(), principal: {} } as any }; },
      run: async () => ({ type: 'answer', message: 'Found images.', sources: [] }),
    }, { ...requestBody, input: { ...requestBody.input, surface: 'media-workspace', currentNote: { title: '', content: '' } } });
    expect(response.status).toBe(200);
    expect(authorization).toEqual({ organizationKey, agentKey });
  });

  test('rejects unknown request fields', async () => {
    const response = await request({ getIdentity: async () => ({ key: newId(), identityType: 'user' }) }, { ...requestBody, unexpected: true });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ success: false, error: { code: 'ASSISTANT_INVALID_INPUT' } });
  });

  test('rejects oversized request bodies before authorization', async () => {
    const response = await request({ getIdentity: async () => ({ key: newId(), identityType: 'user' }) }, { ...requestBody, input: { ...requestBody.input, message: 'x'.repeat(130 * 1024) } });
    expect(response.status).toBe(413);
    expect(await response.json()).toMatchObject({ success: false, error: { code: 'ASSISTANT_REQUEST_TOO_LARGE' } });
  });
});
