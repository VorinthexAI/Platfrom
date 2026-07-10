import { describe, expect, test } from 'bun:test';
import { Webhook } from 'svix';
import { processResendWebhookPayload, recipientEmailFromResendEvent, verifyResendWebhookSignature } from './resend';

function mockDeps() {
  const events: Record<string, any>[] = [];
  const deletedUsers: string[] = [];
  return {
    events,
    deletedUsers,
    deps: {
      async getUserByEmailHash(emailHash: string) {
        if (emailHash === 'hash:missing@example.com') return null;
        return { key: 'usr_test', email: 'person@example.com', emailHash } as any;
      },
      async insertEvent(event: Record<string, any>) {
        events.push(event);
        return event as any;
      },
      async deleteUser(id: string) {
        deletedUsers.push(id);
      },
      async getRootOrganizationId() {
        return 'org_root';
      },
      async hashUserEmail(email: string) {
        return `hash:${email.trim().toLowerCase()}`;
      },
      newId() {
        return 'evt_test';
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

  test('records open and delivery events against the matched user', async () => {
    const opened = mockDeps();
    await expect(processResendWebhookPayload({
      type: 'email.opened',
      created_at: '2026-07-04T10:00:00.000Z',
      data: { to: ['person@example.com'], email_id: 'email_123' },
    }, 'svix_msg_open', opened.deps as any)).resolves.toEqual({
      processed: true,
      matched: true,
      inserted: true,
      deleted: false,
    });
    expect(opened.events[0]).toEqual({
      key: 'evt_test',
      sourceId: 'org_root',
      belongsTo: 'organization',
      userId: 'usr_test',
      slug: 'email.opened',
      data: {
        provider: 'resend',
        user_id: 'usr_test',
        email_hash: 'hash:person@example.com',
        resend_event_id: 'svix_msg_open',
        message_id: 'email_123',
        occurred_at: '2026-07-04T10:00:00.000Z',
      },
      createdAt: expect.any(String),
    });

    const delivered = mockDeps();
    await expect(processResendWebhookPayload({
      type: 'email.delivered',
      data: { to: ['person@example.com'], created_at: '2026-07-04T11:00:00.000Z' },
    }, 'svix_msg_delivered', delivered.deps as any)).resolves.toEqual({
      processed: true,
      matched: true,
      inserted: true,
      deleted: false,
    });
    expect(delivered.events[0]).toEqual(expect.objectContaining({
      sourceId: 'org_root',
      belongsTo: 'organization',
      userId: 'usr_test',
      slug: 'email.delivered',
    }));
    expect(delivered.events[0].data).toEqual(expect.objectContaining({
      resend_event_id: 'svix_msg_delivered',
      occurred_at: '2026-07-04T11:00:00.000Z',
    }));
  });

  test('records permanent bounces and deletes the matched user', async () => {
    const bounced = mockDeps();
    await expect(processResendWebhookPayload({
      type: 'email.bounced',
      data: {
        to: ['person@example.com'],
        bounce: { type: 'Permanent', subType: 'General', message: 'mailbox does not exist' },
      },
    }, 'svix_msg_bounce', bounced.deps as any)).resolves.toEqual({
      processed: true,
      matched: true,
      inserted: true,
      deleted: true,
    });
    expect(bounced.events[0]).toEqual(expect.objectContaining({
      sourceId: 'org_root',
      belongsTo: 'organization',
      userId: 'usr_test',
      slug: 'email.bounced',
    }));
    expect(bounced.events[0].data).toEqual(expect.objectContaining({
      bounce_type: 'Permanent',
      bounce_sub_type: 'General',
    }));
    expect(bounced.deletedUsers).toEqual(['usr_test']);
  });

  test('records transient bounces WITHOUT deleting the user', async () => {
    const bounced = mockDeps();
    await expect(processResendWebhookPayload({
      type: 'email.bounced',
      data: {
        to: ['person@example.com'],
        bounce: { type: 'Transient', subType: 'MailboxFull' },
      },
    }, 'svix_msg_soft_bounce', bounced.deps as any)).resolves.toEqual({
      processed: true,
      matched: true,
      inserted: true,
      deleted: false,
    });
    expect(bounced.events[0]).toEqual(expect.objectContaining({ slug: 'email.bounced' }));
    expect(bounced.events[0].data).toEqual(expect.objectContaining({
      bounce_type: 'Transient',
      bounce_sub_type: 'MailboxFull',
    }));
    expect(bounced.deletedUsers).toEqual([]);
  });

  test('keeps the user when a bounce carries no classification', async () => {
    const bounced = mockDeps();
    await expect(processResendWebhookPayload({
      type: 'email.bounced',
      data: { to: ['person@example.com'] },
    }, 'svix_msg_unclassified_bounce', bounced.deps as any)).resolves.toEqual({
      processed: true,
      matched: true,
      inserted: true,
      deleted: false,
    });
    expect(bounced.events[0].data).toEqual(expect.objectContaining({
      bounce_type: null,
      bounce_sub_type: null,
    }));
    expect(bounced.deletedUsers).toEqual([]);
  });

  test('records complaints without updating or deleting the user', async () => {
    const complained = mockDeps();
    await expect(processResendWebhookPayload({
      type: 'email.complained',
      data: { to: ['person@example.com'] },
    }, 'svix_msg_complaint', complained.deps as any)).resolves.toEqual({
      processed: true,
      matched: true,
      inserted: true,
      deleted: false,
    });
    expect(complained.events[0]).toEqual(expect.objectContaining({
      sourceId: 'org_root',
      belongsTo: 'organization',
      userId: 'usr_test',
      slug: 'email.complained',
    }));
    expect(complained.deletedUsers).toEqual([]);
  });

  test('acknowledges unknown event types without DB writes', async () => {
    const unknown = mockDeps();
    await expect(processResendWebhookPayload({
      type: 'email.clicked',
      data: { to: ['person@example.com'] },
    }, 'svix_msg_clicked', unknown.deps as any)).resolves.toEqual({ ignored: true });
    expect(unknown.events).toEqual([]);
    expect(unknown.deletedUsers).toEqual([]);
  });

  test('skips known event types if the recipient email hash is unknown', async () => {
    const missing = mockDeps();
    await expect(processResendWebhookPayload({
      type: 'email.bounced',
      data: { to: ['missing@example.com'] },
    }, 'svix_msg_missing', missing.deps as any)).resolves.toEqual({
      processed: true,
      matched: false,
      inserted: false,
      deleted: false,
    });
    expect(missing.events).toEqual([]);
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
