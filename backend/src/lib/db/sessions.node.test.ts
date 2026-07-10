import { describe, expect, test } from 'bun:test';
import { visitorSessionSchema } from './visitor-sessions.node';
import { userSessionSchema } from './user-sessions.node';

/**
 * The presence funnel split: anonymous sessions land in `visitorSessions`
 * (keyed by their parent visitor) and authenticated sessions land in the
 * parallel `userSessions` funnel (keyed by the signed-in user). Both share
 * the same session shape — open with a null disconnect stamp, closed with
 * both timestamps — but neither carries an emailHash anymore.
 */
describe('visitorSession node schema (anonymous funnel)', () => {
  test('opens with a null disconnect stamp and no emailHash field', () => {
    const session = visitorSessionSchema.parse({
      key: 'vse_test',
      organizationId: 'org_root',
      visitorId: 'vis_test',
      alias: 'Orbit Surfer',
      sessionKey: 'ses_test',
      connectedAt: '2026-07-07T00:00:00.000Z',
      createdAt: '2026-07-07T00:00:00.000Z',
      updatedAt: '2026-07-07T00:00:00.000Z',
    });

    expect(session.disconnectedAt).toBeNull();
    expect(session.visitorId).toBe('vis_test');
    expect(session.source).toBe('web');
    expect('emailHash' in session).toBe(false);
  });

  test('keeps both timestamps once disconnected and strips any legacy emailHash', () => {
    const session = visitorSessionSchema.parse({
      key: 'vse_test',
      organizationId: 'org_root',
      visitorId: 'vis_test',
      // A legacy activeVisitors doc may still carry emailHash — it is dropped.
      emailHash: 'b'.repeat(64),
      alias: 'Nova Cartographer',
      sessionKey: 'ses_test',
      connectedAt: '2026-07-07T00:00:00.000Z',
      disconnectedAt: '2026-07-07T00:10:00.000Z',
      createdAt: '2026-07-07T00:00:00.000Z',
      updatedAt: '2026-07-07T00:10:00.000Z',
    });

    expect(session.connectedAt).toBe('2026-07-07T00:00:00.000Z');
    expect(session.disconnectedAt).toBe('2026-07-07T00:10:00.000Z');
    expect('emailHash' in session).toBe(false);
  });
});

describe('userSession node schema (authenticated funnel)', () => {
  test('opens keyed by userId with a null disconnect stamp', () => {
    const session = userSessionSchema.parse({
      key: 'use_test',
      organizationId: 'org_root',
      userId: 'usr_test',
      alias: 'Nova Cartographer',
      sessionKey: 'ses_test',
      connectedAt: '2026-07-07T00:00:00.000Z',
      createdAt: '2026-07-07T00:00:00.000Z',
      updatedAt: '2026-07-07T00:00:00.000Z',
    });

    expect(session.disconnectedAt).toBeNull();
    expect(session.userId).toBe('usr_test');
    expect(session.source).toBe('web');
    expect('visitorId' in session).toBe(false);
    expect('emailHash' in session).toBe(false);
  });

  test('keeps both timestamps once disconnected', () => {
    const session = userSessionSchema.parse({
      key: 'use_test',
      organizationId: 'org_root',
      userId: 'usr_test',
      alias: 'Nova Cartographer',
      sessionKey: 'ses_test',
      connectedAt: '2026-07-07T00:00:00.000Z',
      disconnectedAt: '2026-07-07T00:10:00.000Z',
      createdAt: '2026-07-07T00:00:00.000Z',
      updatedAt: '2026-07-07T00:10:00.000Z',
    });

    expect(session.connectedAt).toBe('2026-07-07T00:00:00.000Z');
    expect(session.disconnectedAt).toBe('2026-07-07T00:10:00.000Z');
  });

  test('the two funnels stay distinct: userId vs visitorId', () => {
    const userShape = Object.keys(userSessionSchema.shape);
    const visitorShape = Object.keys(visitorSessionSchema.shape);

    expect(userShape).toContain('userId');
    expect(userShape).toContain('source');
    expect(userShape).not.toContain('visitorId');
    expect(visitorShape).toContain('visitorId');
    expect(visitorShape).toContain('source');
    expect(visitorShape).not.toContain('userId');
    expect(userShape).not.toContain('emailHash');
    expect(visitorShape).not.toContain('emailHash');
  });
});
