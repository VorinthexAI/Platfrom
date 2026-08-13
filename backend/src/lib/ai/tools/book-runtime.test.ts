import { expect, test } from 'bun:test';
import { newId } from '@/lib/ids';
import { runBookContentTool } from './book-runtime';

test('book content tools delegate phased work to the dedicated runtime', async () => {
  const bookKey = newId(); const scopeKey = newId(); const userKey = newId(); const calls: string[] = [];
  const context: any = { organizationKey: 'organization', runtimeScopeKey: scopeKey, principal: { kind: 'member', user: { key: userKey }, userOrganization: { organizationId: 'organization', status: 'active' } } };
  let writeBrief: unknown;
  const bookRuntime: any = { create: async () => { calls.push('create'); return bookKey; }, write: async (key: string, input: unknown) => { calls.push(`write:${key}`); writeBrief = input; } };
  const brief = { scopeKey, topic: 'Thinking', goal: 'Improve', audience: 'Leaders', tone: 'clear', length: 'short' as const, language: 'en' };
  expect(await runBookContentTool('book.create-context', brief, context, { bookRuntime })).toEqual({ bookKey, status: 'planning' });
  expect(await runBookContentTool('book.write', { bookKey, ...brief }, context, { bookRuntime })).toEqual({ bookKey, status: 'ready' });
  expect(calls).toEqual(['create', `write:${bookKey}`]);
  expect(writeBrief).toEqual({ scopeKey, topic: 'Thinking', goal: 'Improve', audience: 'Leaders', tone: 'clear', length: 'short', language: 'en', organizationKey: 'organization' });
});
