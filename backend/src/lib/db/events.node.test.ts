import { describe, expect, test } from 'bun:test';
import { eventSchema } from './events.node';

describe('event schema', () => {
  const event = {
    key: 'cmrnlzf640000qc7k4p5zem5w',
    eventIdentifier: 'a'.repeat(128),
    device: null,
    slug: 'navigation.opened',
    appScopeKey: 'cmrnlzf640001qc7kazsr96k5',
    createdAt: '2026-09-05T12:00:00.000Z',
  };

  test('requires an event identifier and defaults nullable attribution', () => {
    expect(eventSchema.parse(event)).toMatchObject({ userId: null, scopeKey: null, eventIdentifier: 'a'.repeat(128), device: null });
    expect(() => eventSchema.parse({ ...event, eventIdentifier: undefined })).toThrow();
    expect(() => eventSchema.parse({ ...event, eventIdentifier: 'A'.repeat(128) })).toThrow();
    expect(() => eventSchema.parse({ ...event, device: undefined })).toThrow();
    expect(() => eventSchema.parse({ ...event, device: 'web' })).toThrow();
  });

  test('strips Arango and unknown fields on reads', () => {
    expect(eventSchema.parse({ ...event, _key: event.key, distinctId: 'legacy' })).not.toHaveProperty('distinctId');
    expect(eventSchema.parse({ ...event, appKey: 'legacy' })).not.toHaveProperty('appKey');
  });
});
