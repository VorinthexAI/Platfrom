import type { Context } from 'hono';
import { z } from 'zod';
import { upgradeWebSocket } from 'hono/bun';
import { askOrchestrator, OrchestratorNotFoundError } from '@/lib/orchestrators/chat';
import { parseJson, strictObject } from './validation';

const orchestratorChatBodySchema = strictObject({
  orchestrator_id: z.string().trim().min(1),
  message: z.string().trim().min(1),
});

export async function postOrchestratorChat(c: Context) {
  const body = await parseJson(c, orchestratorChatBodySchema);
  try {
    const reply = await askOrchestrator(body.orchestrator_id, body.message);
    return c.json({ reply });
  } catch (err) {
    if (err instanceof OrchestratorNotFoundError) return c.json({ error: 'orchestrator not found' }, 404);
    throw err;
  }
}

const orchestratorChatMessageSchema = z.object({
  orchestrator_id: z.string().trim().min(1),
  message: z.string().trim().min(1),
});

/** GET /orchestrators/chat/stream — one JSON request/reply per WebSocket message. */
export const orchestratorChatSocket = upgradeWebSocket(() => ({
  onMessage: (event, ws) => {
    void (async () => {
      if (typeof event.data !== 'string') {
        ws.send(JSON.stringify({ error: 'expected a JSON text frame' }));
        return;
      }

      let payload: unknown;
      try {
        payload = JSON.parse(event.data);
      } catch {
        ws.send(JSON.stringify({ error: 'invalid JSON' }));
        return;
      }

      const parsed = orchestratorChatMessageSchema.safeParse(payload);
      if (!parsed.success) {
        ws.send(JSON.stringify({ error: 'expected { orchestrator_id, message }' }));
        return;
      }

      try {
        const reply = await askOrchestrator(parsed.data.orchestrator_id, parsed.data.message);
        ws.send(JSON.stringify({ reply }));
      } catch (err) {
        if (err instanceof OrchestratorNotFoundError) {
          ws.send(JSON.stringify({ error: 'orchestrator not found' }));
          return;
        }
        throw err;
      }
    })();
  },
}));
