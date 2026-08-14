import type { Context } from 'hono';
import { streamSSE } from 'hono/streaming';
import { z } from 'zod';
import { AgentExecutionAccessError } from '@/lib/ai/agents/access';
import { AgentRuntimeNotFoundError } from '@/lib/ai/agents/runtime';
import { audioGenerateInputSchema, generateAudioChunks, type AudioGenerateChunk, type AudioGenerateDependencies } from '@/lib/ai/tools/audio-generate';
import { authorizeContentAgentExecution, ContentError, type RunContentAgentToolOptions } from '@/lib/ai/tools';
import { getAuthIdentity } from './security';
import { parseJson, strictObject } from './validation';

const bodySchema = strictObject({
  organizationKey: z.string().trim().min(1),
  agentKey: z.string().cuid(),
  input: audioGenerateInputSchema,
});

export interface AudioGenerateHandlerDependencies {
  getIdentity?: typeof getAuthIdentity;
  authorize?: typeof authorizeContentAgentExecution;
  authorizationOptions?: Omit<RunContentAgentToolOptions, 'authenticatedUserKey' | 'execute'>;
  generate?: (input: unknown, dependencies: AudioGenerateDependencies) => AsyncIterable<AudioGenerateChunk>;
}

/** Authenticated SSE transport for the canonical audio.generate tool. */
export async function postAudioGenerate(c: Context, dependencies: AudioGenerateHandlerDependencies = {}) {
  const identity = await (dependencies.getIdentity ?? getAuthIdentity)(c);
  if (!identity) return c.json({ error: 'authentication required' }, 401);
  if (identity.identityType !== 'user') return c.json({ error: 'user session required' }, 403);
  const body = await parseJson(c, bodySchema);
  try {
    await (dependencies.authorize ?? authorizeContentAgentExecution)(
      { organizationKey: body.organizationKey, agentKey: body.agentKey },
      { ...dependencies.authorizationOptions, authenticatedUserKey: identity.key },
    );
  } catch (error) {
    if (error instanceof ContentError) return c.json({ error: error.toJSON() }, 403);
    if (error instanceof AgentExecutionAccessError) return c.json({ error: 'agent execution access denied' }, 403);
    if (error instanceof AgentRuntimeNotFoundError) return c.json({ error: 'agent runtime not found' }, 404);
    throw error;
  }
  const generate = dependencies.generate ?? generateAudioChunks;
  return streamSSE(c, async (sse) => {
    await sse.writeSSE({ event: 'start', data: JSON.stringify({ wordsPerChunk: body.input.wordsPerChunk }) });
    let completed = 0;
    try {
      for await (const chunk of generate(body.input, { organizationKey: body.organizationKey, signal: c.req.raw.signal })) {
        completed += 1;
        await sse.writeSSE({ event: 'chunk', id: String(chunk.index), data: JSON.stringify(chunk) });
      }
      await sse.writeSSE({ event: 'done', data: JSON.stringify({ completed }) });
    } catch (error) {
      if (c.req.raw.signal.aborted) return;
      console.error('audio generation stream failed', { organizationKey: body.organizationKey, completed, error });
      await sse.writeSSE({ event: 'error', data: JSON.stringify({ error: 'audio generation failed', completed }) });
    }
  });
}
