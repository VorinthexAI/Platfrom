import { describe, expect, test } from 'bun:test';
import { Hono } from 'hono';
import { orchestratorChatQuerySchema, postOrchestratorChat, resolveChatOrchestrator } from './orchestrators';

const orchestrator = {
  key: 'cmrnlzf650006qc7k4p5zem5w',
  name: 'Atlas',
  role: 'CEO',
  voiceId: 'voice',
  skill: 'You are Atlas.',
  createdAt: new Date(0).toISOString(),
  updatedAt: new Date(0).toISOString(),
  embedding: [],
};

describe('orchestrator chat identity', () => {
  test('rejects unauthenticated chat before resolving an orchestrator', async () => {
    const app = new Hono();
    app.post('/orchestrators/chat', postOrchestratorChat);
    const response = await app.request('/orchestrators/chat?orchestrator_slug=atlas', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ message: 'hello, how are you?' }),
    });
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: 'authentication required' });
  });

  test('requires exactly one strict identifier', () => {
    expect(orchestratorChatQuerySchema.parse({ orchestrator_slug: 'atlas' })).toEqual({ orchestrator_slug: 'atlas' });
    expect(() => orchestratorChatQuerySchema.parse({})).toThrow();
    expect(() => orchestratorChatQuerySchema.parse({ orchestrator_id: orchestrator.key, orchestrator_slug: 'atlas' })).toThrow();
    expect(() => orchestratorChatQuerySchema.parse({ orchestrator_slug: 'Atlas', extra: 'nope' })).toThrow();
  });

  test('resolves stable UI slugs without exposing generated keys', async () => {
    let receivedName = '';
    const result = await resolveChatOrchestrator({ orchestrator_slug: 'atlas' }, {
      async getById() { return null; },
      async getByName(name) { receivedName = name; return orchestrator; },
    });
    expect(receivedName).toBe('Atlas');
    expect(result).toEqual(orchestrator);
  });
});
