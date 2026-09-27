import { expect, test } from 'bun:test';
import { classificationForInboxChoice, inboxCategoryFor, inboxSortPlainOutputSchema, inboxSortPushOutputSchema, inboxSortPlainResponseFormat, inboxSortPushResponseFormat, sortInboxMessage } from './classification';

const inbound = { labels: ['INBOX'], subject: 'Account notice', from: 'sender@example.com', body: 'Please review this notice.', direction: 'inbound' as const };

test('defines strict JSON schemas for sort with and without push copy', () => {
  expect(inboxSortPlainOutputSchema.parse({ category: 'Filtered', body: 'Sale on office chairs.' })).toEqual({ category: 'Filtered', body: 'Sale on office chairs.' });
  expect(() => inboxSortPlainOutputSchema.parse({ category: 'Filtered', body: 'Sale.', message: 'Nope' })).toThrow('Unrecognized key');
  expect(inboxSortPushOutputSchema.parse({ category: 'Urgent', body: 'Please review today.', message: 'Ada asked you to review today.' }).message).toBe('Ada asked you to review today.');
  expect(inboxSortPushOutputSchema.parse({ category: 'Filtered', body: 'Weekly digest.', message: '' }).message).toBe('');
  expect(() => inboxSortPushOutputSchema.parse({ category: 'Important', body: 'Hello.', message: '' })).toThrow('Push copy is required');
  expect(() => inboxSortPushOutputSchema.parse({ category: 'Filtered', body: 'Sale.', message: 'You have mail' })).toThrow('Push copy is not allowed');
  expect(inboxSortPlainResponseFormat.schema.required).toEqual(['category', 'body']);
  expect(inboxSortPushResponseFormat.schema.required).toEqual(['category', 'body', 'message']);
});

test('sorts with text JSON, cleans the body, and only returns push copy when requested', async () => {
  const asks: unknown[] = [];
  const ask = (async (_team: string, input: { responseFormat?: { name: string }; systemPrompt: string }) => {
    asks.push(input);
    const push = input.responseFormat?.name === 'inbox_sort_push';
    return { output: { text: JSON.stringify({ category: 'Important', body: 'Your code is 482191.', ...(push ? { message: 'Auth sent code 482191.' } : {}) }) } };
  }) as never;
  const withoutPush = await sortInboxMessage('team', inbound, ask);
  expect(withoutPush).toMatchObject({ inboxCategory: 'Important', body: 'Your code is 482191.' });
  expect(withoutPush.pushMessage).toBeUndefined();
  const withPush = await sortInboxMessage('team', { ...inbound, push: true, subject: 'Your verification code is 482191' }, ask);
  expect(withPush.pushMessage).toBe('Auth sent code 482191.');
  expect(asks[0]).toMatchObject({ responseFormat: { name: 'inbox_sort' } });
  expect(asks[1]).toMatchObject({ responseFormat: { name: 'inbox_sort_push' } });
  expect(classificationForInboxChoice('important', inbound)).toMatchObject({ priority: 'normal', state: 'needs_action', isPurchase: false });
  expect(inboxCategoryFor(['INBOX'], classificationForInboxChoice('purchases', inbound))).toBe('Purchases');
});

test('sends spam and trash through text sort and falls back without dropping notify copy', async () => {
  const asks: string[] = [];
  const ask = (async (_team: string, input: { systemPrompt: string }) => {
    asks.push(input.systemPrompt);
    return { output: { text: JSON.stringify({ category: 'Filtered', body: 'Unwanted prize notice.', message: '' }) } };
  }) as never;
  expect(await sortInboxMessage('team', { ...inbound, labels: ['SPAM'], subject: 'Prize', push: true }, ask)).toMatchObject({ inboxCategory: 'Filtered', body: 'Unwanted prize notice.' });
  expect(asks).toHaveLength(1);
  expect(await sortInboxMessage('team', inbound, async () => ({ output: { text: '{"category":"nope"}' } }) as never)).toMatchObject({ inboxCategory: 'Important', body: 'Please review this notice.' });
  const fallbackPush = await sortInboxMessage('team', { ...inbound, push: true }, async () => { throw new Error('unavailable'); });
  expect(fallbackPush.pushMessage).toContain('sender@example.com');
});
