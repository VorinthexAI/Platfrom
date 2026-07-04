import type { Context } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { ZodError } from 'zod';

export function errorResponse(code: string, message: string, details: unknown = null) {
  return { success: false as const, error: { code, message, details } };
}

export async function errorHandler(error: Error, c: Context) {
  if (error instanceof ZodError) {
    return c.json(errorResponse('VALIDATION_ERROR', 'validation.invalidRequest', error.flatten()), 400);
  }

  if (error instanceof HTTPException) {
    console.warn('http exception', { error, status: error.status });
    return c.json(errorResponse('BAD_REQUEST', error.message), error.status);
  }

  console.error('unhandled error', error);

  const message = process.env.NODE_ENV === 'production'
    ? 'common.internalError'
    : error.message;
  return c.json(errorResponse('INTERNAL_SERVER_ERROR', message), 500);
}
