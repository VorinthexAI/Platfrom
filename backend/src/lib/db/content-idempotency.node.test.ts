import { afterEach, describe, expect, test } from 'bun:test';
import { classifyContentIdempotencyRecord, contentIdempotencyFailureSchema, decryptContentIdempotencyFailure, decryptContentReplayResponse, encryptContentIdempotencyFailure, encryptContentReplayResponse } from './content-idempotency.node';

const originalKey = process.env.ORCHESTRATION_CREDENTIALS_MASTER_KEY;

afterEach(() => {
  if (originalKey === undefined) delete process.env.ORCHESTRATION_CREDENTIALS_MASTER_KEY;
  else process.env.ORCHESTRATION_CREDENTIALS_MASTER_KEY = originalKey;
});

describe('Content idempotency encryption', () => {
  test('encrypts replay responses with authenticated AES-256-GCM without retaining raw tokens', () => {
    process.env.ORCHESTRATION_CREDENTIALS_MASTER_KEY = Buffer.alloc(32, 9).toString('base64');
    const response = { results: [{ data: { token: 'one-time-secret-token' } }] };
    const ciphertext = encryptContentReplayResponse(response);
    expect(ciphertext).toMatch(/^v1:/);
    expect(ciphertext).not.toContain('one-time-secret-token');
    expect(decryptContentReplayResponse(ciphertext)).toEqual(response);
    expect(() => decryptContentReplayResponse(`${ciphertext}x`)).toThrow('Unable to decrypt');
  });

  test('uses only ciphertext in completion query variables', async () => {
    const source = await Bun.file(new URL('./content-idempotency.node.ts', import.meta.url)).text();
    expect(source).toContain('responseCiphertext: @responseCiphertext');
    expect(source).not.toContain('response: @response');
    expect(source).toContain('claim.leaseOwner == @leaseOwner');
    expect(source).toContain('existing.status == "claimed" && existing.requestHash == @requestHash && existing.leaseExpiresAt <= @now');
    expect(source).not.toContain('existing.status == "started" && existing.requestHash == @requestHash && existing.leaseExpiresAt <= @now');
    expect(source).not.toContain('existing.status == "pending" && existing.requestHash == @requestHash && existing.leaseExpiresAt <= @now');
    expect(source).toContain('status: "started", executionStartedAt: @now');
    expect(source).toContain('claim.status == "started"');
    expect(source).toContain('claim.status == "claimed" && claim.leaseOwner == @leaseOwner');
    expect(source).not.toContain('existing.status == "completed" && existing.expiresAt <= @now');
    expect(source).toContain('existing.executionStartedAt == null');
    expect(source).toContain('failureCiphertext: @failureCiphertext');
    expect(source).toContain('failureRetryable: @failureRetryable');
    expect(source).toContain('@retryFailed && existing.status == "failed" && existing.requestHash == @requestHash && existing.failureRetryable == true');
    expect(source).toContain('failureCiphertext: null, failureRetryable: null');
    expect(source).not.toContain('failure: @failure');
  });

  test('classifies completed, active, ambiguous, and hash-conflict records without expiry replay gaps', () => {
    process.env.ORCHESTRATION_CREDENTIALS_MASTER_KEY = Buffer.alloc(32, 9).toString('base64');
    const responseCiphertext = encryptContentReplayResponse({ key: 'result' });
    const failureCiphertext = encryptContentIdempotencyFailure({ code: 'CONTENT_CONFLICT', message: 'Safe failure.', retryable: false });
    const now = '2026-08-23T12:00:00.000Z';
    expect(classifyContentIdempotencyRecord({ requestHash: 'same', status: 'completed', responseCiphertext, expiresAt: '2020-01-01T00:00:00.000Z' }, 'same', now)).toEqual({ status: 'replay', response: { key: 'result' } });
    expect(classifyContentIdempotencyRecord({ requestHash: 'same', status: 'completed', responseCiphertext }, 'different', now)).toEqual({ status: 'conflict' });
    expect(classifyContentIdempotencyRecord({ requestHash: 'same', status: 'started', leaseExpiresAt: '2026-08-23T12:01:00.000Z' }, 'same', now)).toEqual({ status: 'pending' });
    expect(classifyContentIdempotencyRecord({ requestHash: 'same', status: 'started', leaseExpiresAt: '2026-08-23T11:59:00.000Z' }, 'same', now)).toEqual({ status: 'indeterminate' });
    expect(classifyContentIdempotencyRecord({ requestHash: 'same', status: 'pending', leaseExpiresAt: '2026-08-23T12:01:00.000Z' }, 'same', now)).toEqual({ status: 'indeterminate' });
    expect(classifyContentIdempotencyRecord({ requestHash: 'same', status: 'legacy-unknown' }, 'same', now)).toEqual({ status: 'indeterminate' });
    expect(classifyContentIdempotencyRecord({ requestHash: 'same', status: 'failed', failureCiphertext }, 'same', now)).toEqual({ status: 'failed', failure: { code: 'CONTENT_CONFLICT', message: 'Safe failure.', retryable: false } });
  });

  test('encrypts only a strict sanitized terminal failure envelope', () => {
    process.env.ORCHESTRATION_CREDENTIALS_MASTER_KEY = Buffer.alloc(32, 9).toString('base64');
    const failure = { code: 'EMAIL_FAILED', message: 'Safe public failure.', retryable: false };
    const ciphertext = encryptContentIdempotencyFailure(failure);
    expect(ciphertext).toMatch(/^v1:/);
    expect(ciphertext).not.toContain(failure.message);
    expect(decryptContentIdempotencyFailure(ciphertext)).toEqual(failure);
    expect(() => contentIdempotencyFailureSchema.parse({ ...failure, stack: 'secret stack', cause: { token: 'secret' } })).toThrow('Unrecognized');
  });
});
