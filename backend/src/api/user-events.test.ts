import { describe, expect, test } from 'bun:test';
import { NEXUS_SCOPE_KEY } from '@/lib/ai/scopes';
import { appendUserEvents, postUserEventsBodySchema } from './user-events';

const validEvent = {
  distinctId: 'question-1',
  slug: 'waitlist:question' as const,
  payload: {
    step: 1,
    question: 'What are you building?',
    answer: 'A backend service.',
  },
};

const founderNoteViewedEvent = {
  distinctId: 'a'.repeat(64),
  slug: 'waitlist:founder_note_viewed' as const,
  payload: {
    step: 0,
  },
};

const ticketViewedEvent = {
  distinctId: 'a'.repeat(64),
  slug: 'waitlist:ticket_viewed' as const,
  payload: {
    step: 6,
  },
};

describe('user event schemas', () => {
  test('accepts waitlist question events with email hash fallback', () => {
    const body = postUserEventsBodySchema.parse({
      email_hash: 'a'.repeat(64),
      events: [validEvent],
    });

    expect(body.events[0]?.slug).toBe('waitlist:question');
  });

  test('accepts founder note viewed and ticket viewed events', () => {
    const founderBody = postUserEventsBodySchema.parse({
      email_hash: 'a'.repeat(64),
      events: [founderNoteViewedEvent],
    });
    const ticketBody = postUserEventsBodySchema.parse({
      email_hash: 'a'.repeat(64),
      events: [ticketViewedEvent],
    });

    expect(founderBody.events[0]?.slug).toBe('waitlist:founder_note_viewed');
    expect(ticketBody.events[0]?.slug).toBe('waitlist:ticket_viewed');
  });

  test('rejects unregistered user event slugs', () => {
    expect(() => postUserEventsBodySchema.parse({
      email_hash: 'a'.repeat(64),
      events: [{ distinctId: 'dynamic-1', slug: 'anything:custom', payload: { extra: true } }],
    })).toThrow();
  });

  test('rejects unknown event fields', () => {
    expect(() => postUserEventsBodySchema.parse({
      email_hash: 'a'.repeat(64),
      events: [{ ...validEvent, extra: true }],
    })).toThrow();

    expect(() => postUserEventsBodySchema.parse({
      email_hash: 'a'.repeat(64),
      source_id: 'legacy-source',
      events: [validEvent],
    })).toThrow();
  });

  test('rejects empty slugs', () => {
    expect(() => postUserEventsBodySchema.parse({
      email_hash: 'a'.repeat(64),
      events: [{ ...validEvent, slug: '' }],
    })).toThrow();
  });
});

describe('appendUserEvents', () => {
  test('writes user events into the unified events collection', async () => {
    const events: Record<string, unknown>[] = [];
    const updates: Array<{ key: string; patch: Record<string, unknown> }> = [];

    const result = await appendUserEvents({
      emailHash: 'a'.repeat(64),
      events: [{ ...validEvent, createdAt: '2026-07-04T10:00:00.000Z' }],
    }, {
      async getUserByEmailHash(emailHash: string) {
        return { key: 'usr_test', email: 'person@example.com', emailHash } as any;
      },
      async getUserById() {
        return null;
      },
      async insertEvent(event: Record<string, unknown>) {
        events.push(event);
        return event as any;
      },
      newId() {
        return 'evt_test';
      },
      async updateUser(key: string, patch: Record<string, unknown>) {
        updates.push({ key, patch });
        return { key, ...patch } as any;
      },
    });

    expect(result).toEqual({ id: 'usr_test', insertedCount: 1 });
    expect(events[0]).toEqual({
      key: 'evt_test',
      scopeId: NEXUS_SCOPE_KEY,
      userId: 'usr_test',
      slug: 'waitlist:question',
      data: {
        distinctId: 'question-1',
        payload: validEvent.payload,
      },
      createdAt: '2026-07-04T10:00:00.000Z',
    });
    expect(updates).toEqual([{
      key: 'usr_test',
      patch: { updatedAt: expect.any(String) },
    }]);
  });
});
