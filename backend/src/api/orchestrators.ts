import type { Context } from 'hono';
import { z } from 'zod';
import { streamSSE } from 'hono/streaming';
import { getOrchestratorById, getOrchestratorByName, type Orchestrator } from '@/lib/db/orchestrators.node';
import { sanitizedAgentMessageSchema, streamTool } from '@/lib/ai/tools';
import { trackPlatformEvent } from '@/platform/events';
import { getAuthIdentity } from './security';
import { parseJson, parseQuery, strictObject } from './validation';

const orchestratorChatBodySchema = strictObject({
  message: z.string().trim().min(1),
});
const orchestratorSlugSchema = z.string().trim().regex(/^[a-z]+(?:-[a-z]+)*$/);
export const orchestratorChatQuerySchema = strictObject({
  orchestrator_id: z.string().cuid().optional(),
  orchestrator_slug: orchestratorSlugSchema.optional(),
}).refine((query) => Boolean(query.orchestrator_id) !== Boolean(query.orchestrator_slug), {
  message: 'exactly one orchestrator identifier is required',
});

interface OrchestratorLookup {
  getById(id: string): Promise<Orchestrator | null>;
  getByName(name: string): Promise<Orchestrator | null>;
}

export async function resolveChatOrchestrator(
  query: z.infer<typeof orchestratorChatQuerySchema>,
  lookup: OrchestratorLookup = { getById: getOrchestratorById, getByName: getOrchestratorByName },
): Promise<Orchestrator | null> {
  if (query.orchestrator_id) return lookup.getById(query.orchestrator_id);
  const slug = query.orchestrator_slug!;
  return lookup.getByName(slug.split('-').map((part) => part[0]!.toUpperCase() + part.slice(1)).join(' '));
}

/** POST /orchestrators/chat — the unified orchestrator SSE response stream. */
export async function postOrchestratorChat(c: Context) {
  if (!await getAuthIdentity(c)) return c.json({ error: 'authentication required' }, 401);
  const query = parseQuery(c, orchestratorChatQuerySchema);
  const body = await parseJson(c, orchestratorChatBodySchema);
  const message = sanitizedAgentMessageSchema.parse(body.message);
  const orchestrator = await resolveChatOrchestrator(query);
  if (!orchestrator) return c.json({ error: 'orchestrator not found' }, 404);
  trackPlatformEvent({ slug: 'orchestrator.chat.started', data: { orchestratorId: orchestrator.key } });
  const stream = streamTool('chat', orchestrator.skill, { message }, { signal: c.req.raw.signal });
  return streamSSE(c, async (sse) => {
    await sse.writeSSE({ event: 'start', data: JSON.stringify({ orchestrator_id: orchestrator.key }) });
    try {
      for await (const chunk of stream) {
        if (chunk.type === 'text-delta') await sse.writeSSE({ event: 'token', data: JSON.stringify({ text: chunk.text }) });
        if (chunk.type === 'done') {
          trackPlatformEvent({ slug: 'orchestrator.chat.completed', data: { orchestratorId: orchestrator.key } });
          await sse.writeSSE({ event: 'done', data: '{}' });
        }
      }
    } catch (error) {
      console.error('orchestrator chat stream failed', { orchestratorId: orchestrator.key, error });
      trackPlatformEvent({ slug: 'orchestrator.chat.failed', data: { orchestratorId: orchestrator.key } });
      await sse.writeSSE({ event: 'error', data: JSON.stringify({ error: 'orchestrator stream failed' }) });
    }
  });
}
