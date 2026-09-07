import type { Context } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { ZodError } from 'zod';
import { SparkRepositoryError } from '@/lib/sparks/repository';
import { SparkExecutionPendingError } from '@/lib/ai/events/runtime';
import { CommerceError } from '@/lib/commerce/service';
import { PolarProviderError } from '@/lib/commerce/polar';
import { AccountDeletionError } from '@/lib/account-deletion/service';

export function errorResponse(code: string, message: string, details: unknown = null) {
  return { success: false as const, error: { code, message, details } };
}

export function projectSparkError(error: unknown) {
  if (error instanceof SparkExecutionPendingError) return { status: 409 as const, body: errorResponse('BILLING_EXECUTION_PENDING', 'billing.executionPending') };
  if (!(error instanceof SparkRepositoryError)) return null;
  if (error.code === 'INSUFFICIENT_BALANCE') return { status: 402 as const, body: errorResponse('INSUFFICIENT_BALANCE', 'billing.insufficientBalance') };
  if (error.code === 'OUTSTANDING_DEBT') return { status: 402 as const, body: errorResponse('OUTSTANDING_DEBT', 'billing.outstandingDebt') };
  if (error.code === 'USER_NOT_FOUND') return { status: 404 as const, body: errorResponse('SPARK_ACCOUNT_NOT_FOUND', 'billing.accountNotFound') };
  return null;
}

export function sparkErrorResponse(c: Context, error: unknown) {
  const projected = projectSparkError(error);
  return projected ? c.json(projected.body, projected.status) : null;
}

export async function errorHandler(error: Error, c: Context) {
  const spark = projectSparkError(error);
  if (spark) return c.json(spark.body, spark.status);
  if (error instanceof ZodError) {
    return c.json(errorResponse('VALIDATION_ERROR', 'validation.invalidRequest', error.flatten()), 400);
  }
  if (error instanceof CommerceError) {
    const status = error.code === 'PRODUCT_NOT_FOUND' || error.code === 'SUBSCRIPTION_NOT_FOUND' || error.code === 'ACCOUNT_NOT_FOUND' ? 404
      : error.code === 'PRODUCT_INACTIVE' || error.code === 'CHECKOUT_CONFLICT' || error.code === 'CHECKOUT_PENDING' || error.code === 'SUBSCRIPTION_EXISTS' ? 409
      : error.code === 'PRODUCT_NOT_SYNCED' ? 503 : 422;
    return c.json(errorResponse(error.code, error.message), status);
  }
  if (error instanceof PolarProviderError) return c.json(errorResponse(`POLAR_${error.code}`, error.message), error.code === 'NOT_CONFIGURED' ? 503 : 502);
  if (error instanceof AccountDeletionError) return c.json(errorResponse(error.code, error.message), 409);

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
