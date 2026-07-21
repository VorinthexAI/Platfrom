import type { Context } from 'hono';
import { z } from 'zod';
import { streamSSE } from 'hono/streaming';
import { getOrchestratorById } from '@/lib/db/orchestrators.node';
import { sanitizedAgentMessageSchema, streamTool } from '@/lib/ai/tools';
import { trackPlatformEvent } from '@/platform/events';
import { parseJson, parseQuery, strictObject } from './validation';

const orchestratorChatBodySchema = strictObject({
  message: z.string().trim().min(1),
});
const orchestratorChatQuerySchema = strictObject({ orchestrator_id: z.string().cuid() });

/** POST /orchestrators/chat — the unified orchestrator SSE response stream. */
export async function postOrchestratorChat(c: Context) {
  const query = parseQuery(c, orchestratorChatQuerySchema);
  const body = await parseJson(c, orchestratorChatBodySchema);
  const message = sanitizedAgentMessageSchema.parse(body.message);
  const orchestrator = await getOrchestratorById(query.orchestrator_id);
  if (!orchestrator) return c.json({ error: 'orchestrator not found' }, 404);
  trackPlatformEvent({ slug: 'orchestrator.chat.started', data: { orchestratorId: query.orchestrator_id } });
  const stream = streamTool('orchestrator.chat', orchestrator.skill, { message }, { signal: c.req.raw.signal });
  return streamSSE(c, async (sse) => {
    await sse.writeSSE({ event: 'start', data: JSON.stringify({ orchestrator_id: query.orchestrator_id }) });
    try {
      for await (const chunk of stream) {
        if (chunk.type === 'text-delta') await sse.writeSSE({ event: 'token', data: JSON.stringify({ text: chunk.text }) });
        if (chunk.type === 'done') {
          trackPlatformEvent({ slug: 'orchestrator.chat.completed', data: { orchestratorId: query.orchestrator_id } });
          await sse.writeSSE({ event: 'done', data: '{}' });
        }
      }
    } catch (error) {
      console.error('orchestrator chat stream failed', { orchestratorId: query.orchestrator_id, error });
      trackPlatformEvent({ slug: 'orchestrator.chat.failed', data: { orchestratorId: query.orchestrator_id } });
      await sse.writeSSE({ event: 'error', data: JSON.stringify({ error: 'orchestrator stream failed' }) });
    }
  });
}
