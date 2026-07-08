import { describe, expect, test } from 'bun:test';
import { buildPresenceEventData } from './presence';

describe('presence event payloads', () => {
  test('logs user presence with only the allowed event fields', () => {
    expect(buildPresenceEventData({
      presenceType: 'user',
      source: 'web',
      userId: 'usr_test',
    })).toEqual({
      presence_type: 'user',
      source: 'web',
      user_id: 'usr_test',
    });
  });

  test('logs visitor presence with only the allowed event fields', () => {
    expect(buildPresenceEventData({
      presenceType: 'visitor',
      source: 'mobile',
      visitorId: 'vis_test',
    })).toEqual({
      presence_type: 'visitor',
      source: 'mobile',
      visitor_id: 'vis_test',
    });
  });
});
