import { describe, expect, test } from 'bun:test';
import { buildUpdatesUnsubscribeLink, hasUsableUpdatesUnsubscribeRequest } from './updates';

describe('updates unsubscribe helpers', () => {
  test('builds frontend unsubscribe links with token hash query param', () => {
    process.env.FRONTEND_URL = 'https://app.example.com';

    expect(buildUpdatesUnsubscribeLink('abc123')).toBe('https://app.example.com/public/updates/unsubscribe?token_hash=abc123');
  });

  test('accepts unsubscribe requests only inside the 15 minute window', () => {
    const requestedAt = '2026-07-03T10:00:00.000Z';

    expect(hasUsableUpdatesUnsubscribeRequest({
      is_subscribed_to_updates_unsubscribe_requested_at: requestedAt,
    }, Date.parse('2026-07-03T10:14:59.000Z'))).toBe(true);

    expect(hasUsableUpdatesUnsubscribeRequest({
      is_subscribed_to_updates_unsubscribe_requested_at: requestedAt,
    }, Date.parse('2026-07-03T10:15:00.000Z'))).toBe(false);

    expect(hasUsableUpdatesUnsubscribeRequest({
      is_subscribed_to_updates_unsubscribe_requested_at: null,
    }, Date.parse('2026-07-03T10:01:00.000Z'))).toBe(false);
  });
});
