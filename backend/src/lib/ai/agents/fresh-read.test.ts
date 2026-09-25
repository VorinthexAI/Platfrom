import { describe, expect, test } from 'bun:test';
import { newId } from '@/lib/ids';
import { requiresFreshWorkspaceRead } from './fresh-read';

const teamKey = newId(), userKey = newId(), scopeKey = newId();
const context = { teamKey, runtimeScopeKey: scopeKey, principal: { kind: 'member', user: { key: userKey }, userTeam: { key: newId(), teamKey, userId: userKey, status: 'active' } } } as never;

describe('fresh read preflight', () => {
  test('forces a current read for a repeated trip reference indexed in the authorized scope', async () => {
    const queries: string[] = [];
    const result = await requiresFreshWorkspaceRead('Does Nordic Rail agree with Train Notes about the departure?', context, ['Your Nordic Rail guide says Friday at 09:15.'], (async (phrase: string) => {
      queries.push(phrase);
      return phrase === 'nordic rail' ? [{ source: 'trips', key: newId(), label: 'Nordic Rail' }] : [];
    }) as never);
    expect(result).toBe(true);
    expect(queries).toContain('nordic rail');
  });

  test('forces a current read for an inbox follow-up even when its full subject was not repeated', async () => {
    expect(await requiresFreshWorkspaceRead('Which inbox contains my rail booking?', context, ['The rail booking email says Friday at 09:15.'], (async (phrase: string) => phrase === 'rail booking' ? [{ source: 'emailMessages', key: newId(), label: 'Rail booking confirmation' }] : []) as never)).toBe(true);
  });

  test('does not route general conversation or unrelated context into private reads', async () => {
    let calls = 0;
    const find = (async () => { calls++; return []; }) as never;
    expect(await requiresFreshWorkspaceRead('What is a black hole?', context, ['My album is called Aurora Album.'], find)).toBe(false);
    expect(calls).toBe(0);
    expect(await requiresFreshWorkspaceRead('What is a black hole?', context, ['We previously discussed a black hole.'], find)).toBe(false);
    expect(calls).toBeGreaterThan(0);
  });

  test('does not rely on an unverified historical count if the indexed check fails', async () => {
    expect(await requiresFreshWorkspaceRead('Which inbox contains my rail booking?', context, ['My rail booking is in Work Mail.'], (async () => { throw new Error('Search unavailable'); }) as never)).toBe(true);
  });
});
