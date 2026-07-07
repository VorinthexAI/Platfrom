import { describe, expect, test } from 'bun:test';
import { eventSchema } from '@/lib/db/events.node';
import { clientEventSlugSchema, eventSlugSchema, landingEventSlugs } from './events';

describe('event catalog', () => {
  test('accepts dynamic event slugs', () => {
    expect(eventSlugSchema.parse('waitlist.visited')).toBe('waitlist.visited');
    expect(eventSlugSchema.parse('anything.custom')).toBe('anything.custom');
  });

  test('uses the same dynamic schema for client-postable events', () => {
    expect(clientEventSlugSchema.parse('waitlist.visited')).toBe('waitlist.visited');
    expect(clientEventSlugSchema.parse('payment.ticket_purchased')).toBe('payment.ticket_purchased');
  });

  test('defines the complete landing event catalog', () => {
    expect(landingEventSlugs).toEqual([
      'landing.page_viewed',
      'landing.product_entered',
      'landing.orchestrator_entered',
      'landing.capability_entered',
      'landing.rock_entered',
      'landing.cta_clicked',
      'landing.cave_opened',
      'landing.cave_closed',
      'landing.audio_played',
      'landing.fragment_discovered',
      'landing.fragment_claim_clicked',
      'landing.fragment_join_to_claim_clicked',
      'waitlist.form_started',
      'waitlist.submit_clicked',
      'waitlist.signup_submitted',
      'waitlist.email_verified',
      'auth.signin_opened',
      'auth.member_gate_opened',
      'legal.opened',
      'fragments.collected',
    ]);
  });

  test('rejects empty event slugs', () => {
    expect(() => eventSlugSchema.parse('')).toThrow();
  });

  test('event records separate source ownership from optional user ownership', () => {
    expect(eventSchema.parse({
      key: 'evt_test',
      sourceId: 'plt_this',
      belongsTo: 'platform',
      slug: 'waitlist.visited',
      createdAt: '2026-07-04T10:00:00.000Z',
    })).toEqual({
      key: 'evt_test',
      sourceId: 'plt_this',
      belongsTo: 'platform',
      userId: null,
      slug: 'waitlist.visited',
      data: null,
      embedding: [],
      createdAt: '2026-07-04T10:00:00.000Z',
    });
  });

});
