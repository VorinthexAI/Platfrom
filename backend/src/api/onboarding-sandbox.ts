import type { Context } from 'hono';
import { z } from 'zod';
import { EVENT_IDENTIFIER_HEADER, eventIdentifierSchema } from '@/lib/ai/events/event-identifier';
import { OnboardingSandboxError, onboardingSandboxPromptIdSchema, onboardingSandboxService } from '@/lib/onboarding-sandbox/service';
import { parseJson, strictObject } from './validation';

const createSessionSchema = strictObject({});
const answerSchema = strictObject({
  token: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  promptId: onboardingSandboxPromptIdSchema,
});

function installationIdentifier(c: Context) {
  return eventIdentifierSchema.parse(c.req.header(EVENT_IDENTIFIER_HEADER));
}

function sandboxError(c: Context, error: OnboardingSandboxError) {
  if (error.code === 'expired') return c.json({ error: 'sandbox session expired', code: 'SANDBOX_SESSION_EXPIRED' }, 410);
  if (error.code === 'forbidden') return c.json({ error: 'sandbox session is unavailable', code: 'SANDBOX_SESSION_FORBIDDEN' }, 403);
  if (error.code === 'limit') return c.json({ error: 'sandbox question limit reached', code: 'SANDBOX_LIMIT_REACHED' }, 409);
  c.header('Retry-After', '2');
  return c.json({ error: 'sandbox response is already processing', code: 'SANDBOX_RESPONSE_PROCESSING' }, 409);
}

export function createOnboardingSandboxHandlers(service: Pick<typeof onboardingSandboxService, 'answer' | 'createSession'> = onboardingSandboxService) {
  return {
    createSession: async (c: Context) => {
      await parseJson(c, createSessionSchema);
      c.header('Cache-Control', 'no-store');
      return c.json(await service.createSession(installationIdentifier(c)), 201);
    },
    answer: async (c: Context) => {
      const input = await parseJson(c, answerSchema);
      c.header('Cache-Control', 'no-store');
      try {
        return c.json(await service.answer(installationIdentifier(c), input.token, input.promptId, c.req.raw.signal));
      } catch (error) {
        if (error instanceof OnboardingSandboxError) return sandboxError(c, error);
        throw error;
      }
    },
  };
}

export const onboardingSandboxHandlers = createOnboardingSandboxHandlers();
