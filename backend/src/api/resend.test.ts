import { describe, expect, test } from 'bun:test';
import { Webhook } from 'svix';
import { processResendWebhookPayload, recipientEmailFromResendEvent, verifyResendWebhookSignature } from './resend';

function mockDeps() {
  const deletedUsers: string[] = [];
  return {
    deletedUsers,
    deps: {
      async getUserByEmailHash(emailHash: string) {
        if (emailHash === 'hash:missing@example.com') return null;
        return { key: 'usr_test', email: 'person@example.com', emailHash } as any;
      },
      async deleteUser(id: string) {
        deletedUsers.push(id);
      },
      async hashUserEmail(email: string) {
        return `hash:${email.trim().toLowerCase()}`;
      },
    },
  };
}

describe('Resend webhook payload processing', () => {
  test('extracts the first recipient email', () => {
    expect(recipientEmailFromResendEvent({
      type: 'email.opened',
      data: { to: ['first@example.com', 'second@example.com'] },
    })).toBe('first@example.com');
  });

  test('ignores delivery lifecycle events', async () => {
    const opened = mockDeps();
    await expect(processResendWebhookPayload({
      type: 'email.opened',
      created_at: '2026-07-04T10:00:00.000Z',
      data: { to: ['person@example.com'], email_id: 'email_123' },
    }, opened.deps as any)).resolves.toEqual({ ignored: true });

    const delivered = mockDeps();
    await expect(processResendWebhookPayload({
      type: 'email.delivered',
      data: { to: ['person@example.com'], created_at: '2026-07-04T11:00:00.000Z' },
    }, delivered.deps as any)).resolves.toEqual({ ignored: true });
  });

  test('deletes the matched user after a permanent bounce', async () => {
    const bounced = mockDeps();
    await expect(processResendWebhookPayload({
      type: 'email.bounced',
      data: {
        to: ['person@example.com'],
        bounce: { type: 'Permanent', subType: 'General', message: 'mailbox does not exist' },
      },
    }, bounced.deps as any)).resolves.toEqual({
      processed: true,
      matched: true,
      deleted: true,
    });
    expect(bounced.deletedUsers).toEqual(['usr_test']);
  });

  test('keeps the user after a transient bounce', async () => {
    const bounced = mockDeps();
    await expect(processResendWebhookPayload({
      type: 'email.bounced',
      data: {
        to: ['person@example.com'],
        bounce: { type: 'Transient', subType: 'MailboxFull' },
      },
    }, bounced.deps as any)).resolves.toEqual({
      processed: true,
      matched: true,
      deleted: false,
    });
    expect(bounced.deletedUsers).toEqual([]);
  });

  test('keeps the user when a bounce carries no classification', async () => {
    const bounced = mockDeps();
    await expect(processResendWebhookPayload({
      type: 'email.bounced',
      data: { to: ['person@example.com'] },
    }, bounced.deps as any)).resolves.toEqual({
      processed: true,
      matched: true,
      deleted: false,
    });
    expect(bounced.deletedUsers).toEqual([]);
  });

  test('ignores complaints', async () => {
    const complained = mockDeps();
    await expect(processResendWebhookPayload({
      type: 'email.complained',
      data: { to: ['person@example.com'] },
    }, complained.deps as any)).resolves.toEqual({ ignored: true });
    expect(complained.deletedUsers).toEqual([]);
  });

  test('acknowledges unknown event types without DB writes', async () => {
    const unknown = mockDeps();
    await expect(processResendWebhookPayload({
      type: 'email.clicked',
      data: { to: ['person@example.com'] },
    }, unknown.deps as any)).resolves.toEqual({ ignored: true });
    expect(unknown.deletedUsers).toEqual([]);
  });

  test('skips known event types if the recipient email hash is unknown', async () => {
    const missing = mockDeps();
    await expect(processResendWebhookPayload({
      type: 'email.bounced',
      data: { to: ['missing@example.com'] },
    }, missing.deps as any)).resolves.toEqual({
      processed: true,
      matched: false,
      deleted: false,
    });
    expect(missing.deletedUsers).toEqual([]);
  });
});

describe('Resend webhook signature verification', () => {
  test('verifies Svix signed raw bodies', () => {
    const secret = `whsec_${Buffer.from('resend-test-secret').toString('base64')}`;
    const webhook = new Webhook(secret);
    const rawBody = JSON.stringify({
      type: 'email.opened',
      data: { to: ['person@example.com'] },
    });
    const svixId = 'msg_test';
    const timestamp = new Date();
    const svixSignature = webhook.sign(svixId, timestamp, rawBody);

    expect(verifyResendWebhookSignature({
      rawBody,
      svixId,
      svixTimestamp: Math.floor(timestamp.getTime() / 1000).toString(),
      svixSignature,
      secret,
    })).toEqual({
      type: 'email.opened',
      data: { to: ['person@example.com'] },
    });
  });

  test('rejects missing Svix headers', () => {
    expect(verifyResendWebhookSignature({
      rawBody: '{}',
      secret: `whsec_${Buffer.from('resend-test-secret').toString('base64')}`,
    })).toBeNull();
  });
});
