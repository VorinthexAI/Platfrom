import type { Context } from 'hono';
import { streamSSE } from 'hono/streaming';
import { z, ZodError } from 'zod';
import { authorizeContentExecution, type ToolContext } from '@/lib/ai/tools';
import { contentPipelineReviewInputSchema, contentPipelineRunInputSchema, reviewContentCard, runContentPipeline, type ContentPipelineEvent } from '@/lib/ai/pipelines';
import { getAuthIdentity } from './security';
import { parseJson } from './validation';
import { authenticatedTeamContext } from './auth';
import { projectSparkError } from './errors';

const selected = <T extends z.ZodRawShape>(shape: T) => z.object({ scopeKey: z.string().cuid(), ...shape }).strict();

async function authenticated(c: Context, scopeKey: string): Promise<ToolContext | Response> {
  const identity = await getAuthIdentity(c);
  if (!identity) return c.json({ success: false, error: 'authentication required' }, 401);
  return (await authorizeContentExecution({ scopeKey }, authenticatedTeamContext(identity))).context;
}

export async function streamContentPipeline(c: Context) {
  try {
    const body = await parseJson(c, selected(contentPipelineRunInputSchema.shape));
    const context = await authenticated(c, body.scopeKey);
    if (context instanceof Response) return context;
    const { scopeKey: _scopeKey, ...input } = body;
    return streamSSE(c, async (stream) => {
      const abort = new AbortController();
      stream.onAbort(() => abort.abort());
      try {
        await runContentPipeline(context, input, async (event: ContentPipelineEvent) => {
          await stream.writeSSE({ event: event.type, data: JSON.stringify(event) });
        }, { signal: abort.signal });
      } catch (error) {
        if (abort.signal.aborted) return;
        const billing = projectSparkError(error);
        const message = billing?.body.error.message ?? (error instanceof Error ? error.message : 'Pipeline run failed.');
        await stream.writeSSE({ event: 'error', data: JSON.stringify({ type: 'error', message }) });
      }
    });
  } catch (error) {
    if (error instanceof ZodError || error instanceof SyntaxError) return c.json({ success: false, error: 'invalid pipeline request' }, 400);
    console.error('pipeline run failed', { error });
    return c.json({ success: false, error: 'pipeline run failed' }, 500);
  }
}

export async function reviewContentPipelineCard(c: Context) {
  try {
    const body = await parseJson(c, selected(contentPipelineReviewInputSchema.shape));
    const context = await authenticated(c, body.scopeKey);
    if (context instanceof Response) return context;
    const node = await reviewContentCard(context, { nodeKey: body.nodeKey, decision: body.decision });
    return c.json({ success: true, data: { node } });
  } catch (error) {
    if (error instanceof ZodError || error instanceof SyntaxError) return c.json({ success: false, error: 'invalid pipeline review' }, 400);
    const message = error instanceof Error ? error.message : 'Pipeline review failed.';
    const status = message.includes('already has one review') ? 409 : message.includes('not available') ? 404 : 500;
    return c.json({ success: false, error: message }, status);
  }
}
