import { afterEach, describe, expect, test } from 'bun:test';
import { decryptArchiveReplayResponse, encryptArchiveReplayResponse } from './archive-idempotency.node';

const originalKey = process.env.ORCHESTRATION_CREDENTIALS_MASTER_KEY;

afterEach(() => {
  if (originalKey === undefined) delete process.env.ORCHESTRATION_CREDENTIALS_MASTER_KEY;
  else process.env.ORCHESTRATION_CREDENTIALS_MASTER_KEY = originalKey;
});

describe('Archive idempotency encryption', () => {
  test('encrypts replay responses with authenticated AES-256-GCM without retaining raw tokens', () => {
    process.env.ORCHESTRATION_CREDENTIALS_MASTER_KEY = Buffer.alloc(32, 9).toString('base64');
    const response = { results: [{ data: { token: 'one-time-secret-token' } }] };
    const ciphertext = encryptArchiveReplayResponse(response);
    expect(ciphertext).toMatch(/^v1:/);
    expect(ciphertext).not.toContain('one-time-secret-token');
    expect(decryptArchiveReplayResponse(ciphertext)).toEqual(response);
    expect(() => decryptArchiveReplayResponse(`${ciphertext}x`)).toThrow('Unable to decrypt');
  });

  test('uses only ciphertext in completion query variables', async () => {
    const source = await Bun.file(new URL('./archive-idempotency.node.ts', import.meta.url)).text();
    expect(source).toContain('responseCiphertext: @responseCiphertext');
    expect(source).not.toContain('response: @response');
    expect(source).toContain('claim.leaseOwner == @leaseOwner');
    expect(source).not.toContain('existing.leaseExpiresAt <= @now');
    expect(source).toContain('existing.status == "completed" && existing.expiresAt <= @now');
    expect(source).toContain('existing.expiresAt <= @now');
  });
});
