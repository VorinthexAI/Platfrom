import { describe, expect, test } from 'bun:test';
import { NEXUS_SCOPE_KEY } from '@/lib/ai/scopes';
import { eventSchema, eventsEmbedKeys } from '@/lib/db/events.node';
import { clientEventSlugSchema, eventSlugSchema, landingEventSlugs, providerEventSlugs, registeredEventSlugs, runtimeEventDataSchema, runtimeEventSlugs, userEventSlugs } from './events';

describe('event catalog', () => {
  test('accepts only registered event slugs', () => {
    expect(new Set(registeredEventSlugs).size).toBe(registeredEventSlugs.length);
    expect(eventSlugSchema.parse('landing.page_viewed')).toBe('landing.page_viewed');
    expect(eventSlugSchema.parse('agent.started')).toBe('agent.started');
    expect(eventSlugSchema.parse('payment.ticket_purchased')).toBe('payment.ticket_purchased');
    expect(eventSlugSchema.parse('waitlist:question')).toBe('waitlist:question');
    expect(eventSlugSchema.parse('email.bounced')).toBe('email.bounced');
    expect(eventSlugSchema.parse('organization.provider.usage')).toBe('organization.provider.usage');
    expect(() => eventSlugSchema.parse('anything.custom')).toThrow();
  });

  test('registers user-ingestion and provider webhook slugs', () => {
    expect(userEventSlugs).toEqual(['waitlist:question', 'waitlist:founder_note_viewed', 'waitlist:ticket_viewed']);
    expect(providerEventSlugs).toEqual(['email.opened', 'email.delivered', 'email.bounced', 'email.complained']);
  });

  test('allows only browser-safe catalog events from clients', () => {
    expect(clientEventSlugSchema.parse('landing.page_viewed')).toBe('landing.page_viewed');
    expect(() => clientEventSlugSchema.parse('payment.ticket_purchased')).toThrow();
    expect(() => clientEventSlugSchema.parse('agent.started')).toThrow();
  });

  test('registers the complete generic runtime lifecycle catalog', () => {
    expect(runtimeEventSlugs).toEqual([
      'agent.started', 'agent.completed', 'agent.failed',
      'step.started', 'step.completed', 'step.failed',
      'tool.called', 'tool.completed', 'tool.failed',
      'model.called', 'model.completed', 'model.failed',
      'artifact.created', 'artifact.updated', 'artifact.deleted', 'artifact.resolved', 'artifact.used', 'guardrail.blocked',
    ]);
    expect(registeredEventSlugs).toEqual(expect.arrayContaining(runtimeEventSlugs));
  });

  test('keeps runtime payloads small, typed and free of full input/output', () => {
    const data = runtimeEventDataSchema.parse({ runKey: NEXUS_SCOPE_KEY, agentKey: NEXUS_SCOPE_KEY, status: 'completed', inputTokens: 10, outputTokens: 4, elapsedMs: 25 });
    expect(data).toMatchObject({ inputTokens: 10, outputTokens: 4, elapsedMs: 25 });
    expect(() => runtimeEventDataSchema.parse({ input: { secret: true } })).toThrow();
    expect(() => runtimeEventDataSchema.parse({ output: 'full result' })).toThrow();
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
