import { describe, expect, test } from 'bun:test';
import { MANAGED_INBOX_DEEP_LINK_PATH, managedInboxDeepLinkUrl } from './deep-links';

describe('managed inbox deep links', () => {
  test('builds the unread inbox path from FRONTEND_URL', () => {
    expect(MANAGED_INBOX_DEEP_LINK_PATH).toBe('/capability/signal');
    expect(managedInboxDeepLinkUrl({ FRONTEND_URL: 'https://app.example.com' })).toBe('https://app.example.com/capability/signal');
    expect(managedInboxDeepLinkUrl({ FRONTEND_AUTH_URL: 'https://auth.example.com/' })).toBe('https://auth.example.com/capability/signal');
    expect(() => managedInboxDeepLinkUrl({})).toThrow('FRONTEND_URL');
  });
});
