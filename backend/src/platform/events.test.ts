import { describe, expect, test } from 'bun:test';
import { NEXUS_SCOPE_KEY } from '@/lib/ai/scopes';
import { eventSchema, eventsEmbedKeys } from '@/lib/db/events.node';
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
      'landing.ambient_audio_started',
      'landing.mission_voice_played',
      'landing.mission_voice_cancelled',
      'landing.biome_fragment_collected',
      'landing.crystal_collected',
      'landing.crystal_room_filled',
      'landing.fragment_discovered',
      'landing.fragment_collect_clicked',
      'landing.fragment_join_to_collect_clicked',
      'landing.collect_gate_shown',
      'waitlist.form_started',
      'waitlist.submit_clicked',
      'waitlist.signup_submitted',
      'waitlist.email_verified',
      'auth.signin_opened',
      'auth.signin_email_sent',
      'auth.magic_link_authenticated',
      'auth.signin_authed_jump',
      'auth.member_gate_opened',
      'waitlist.verify_jump_started',
      'leaderboard.daily_digest_sent',
      'legal.opened',
      'fragments.collected',
    ]);
  });

  test('rejects empty event slugs', () => {
    expect(() => eventSlugSchema.parse('')).toThrow();
  });

  test('event records belong to a scope with optional user ownership', () => {
    expect(eventSchema.parse({
      key: 'evt_test',
      scopeId: NEXUS_SCOPE_KEY,
      sourceId: 'legacy-source',
      belongsTo: 'organization',
      slug: 'waitlist.visited',
      createdAt: '2026-07-04T10:00:00.000Z',
    })).toEqual({
      key: 'evt_test',
      scopeId: NEXUS_SCOPE_KEY,
      userId: null,
      slug: 'waitlist.visited',
      data: null,
      embedding: [],
      createdAt: '2026-07-04T10:00:00.000Z',
    });
    expect(() => eventSchema.parse({ key: 'evt_test', scopeId: 'not-a-cuid', slug: 'x', createdAt: '2026-07-04T10:00:00.000Z' })).toThrow();
    expect(eventsEmbedKeys.options).toEqual(['slug']);
  });

});
