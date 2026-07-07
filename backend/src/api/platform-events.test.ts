import { describe, expect, test } from 'bun:test';
import { platformEventsBodySchema } from './platform-events';
import { landingEventSlugSchema, landingEventSlugs } from '@/platform/events';

describe('platform event schemas', () => {
  test('catalog contains the 30 landing events', () => {
    expect(landingEventSlugs).toHaveLength(30);
    expect(landingEventSlugSchema.parse('landing.product_entered')).toBe('landing.product_entered');
    expect(landingEventSlugSchema.parse('fragments.collected')).toBe('fragments.collected');
    expect(landingEventSlugSchema.parse('landing.crystal_collected')).toBe('landing.crystal_collected');
    expect(landingEventSlugSchema.parse('auth.magic_link_authenticated')).toBe('auth.magic_link_authenticated');
  });

  test('accepts temporary email hash for anonymous frontend events', () => {
    const body = platformEventsBodySchema.parse({
      distinctId: 'a'.repeat(64),
      temp_email_hash: 'a'.repeat(64),
      slug: 'landing.page_viewed',
      metadata: { path: '/' },
    });

    expect(body.temp_email_hash).toBe('a'.repeat(64));
  });

  test('keeps temporary hash separate from event metadata validation', () => {
    const body = platformEventsBodySchema.parse({
      distinctId: 'b'.repeat(64),
      temp_email_hash: 'b'.repeat(64),
      slug: 'landing.fragment_claim_clicked',
      metadata: { collectible_id: 'collectible.frag-belt-1' },
    });

    expect(body.metadata?.collectible_id).toBe('collectible.frag-belt-1');
    expect(body.temp_email_hash).toBe('b'.repeat(64));
  });

  test('rejects malformed temporary email hashes and unknown fields', () => {
    expect(() => platformEventsBodySchema.parse({
      distinctId: 'visitor',
      temp_email_hash: 'not-a-hash',
      slug: 'landing.page_viewed',
    })).toThrow();

    expect(() => platformEventsBodySchema.parse({
      distinctId: 'visitor',
      slug: 'landing.page_viewed',
      extra: true,
    })).toThrow();
  });
});
