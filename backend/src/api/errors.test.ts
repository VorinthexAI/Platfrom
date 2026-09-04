import { describe, expect, test } from 'bun:test';
import { Hono } from 'hono';
import { SparkRepositoryError } from '@/lib/sparks/repository';
import { SparkExecutionPendingError } from '@/lib/ai/events/runtime';
import { errorHandler, projectSparkError } from './errors';

describe('central API errors', () => {
  test('projects insufficient Spark balance as HTTP 402', async () => {
    const error = new SparkRepositoryError('INSUFFICIENT_BALANCE', 'private detail');
    expect(projectSparkError(error)).toEqual({ status: 402, body: { success: false, error: { code: 'INSUFFICIENT_BALANCE', message: 'billing.insufficientBalance', details: null } } });
    const app = new Hono();
    app.get('/', () => { throw error; });
    app.onError(errorHandler);
    const response = await app.request('/');
    expect(response.status).toBe(402);
    expect(await response.json()).toEqual({ success: false, error: { code: 'INSUFFICIENT_BALANCE', message: 'billing.insufficientBalance', details: null } });
  });

  test('leaves unrelated errors for existing handlers', () => {
    expect(projectSparkError(new Error('other'))).toBeNull();
  });

  test('projects an active duplicate execution as a conflict', () => {
    expect(projectSparkError(new SparkExecutionPendingError('transaction-1'))).toEqual({ status: 409, body: { success: false, error: { code: 'BILLING_EXECUTION_PENDING', message: 'billing.executionPending', details: null } } });
  });
});
