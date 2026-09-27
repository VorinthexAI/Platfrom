import { expect, test } from 'bun:test';
import { buildInboxDecisionInput, classificationForInboxChoice, classifyEmailWithFallback, INBOX_CATEGORY_CRITERIA, INBOX_CATEGORY_INSTRUCTIONS, INBOX_CATEGORY_QUESTION, inboxCategoryFor } from './classification';

const inbound = { labels: ['INBOX'], subject: 'Account notice', from: 'sender@example.com', body: 'Please review this notice.', direction: 'inbound' as const };

test('builds a Jev decide payload with ordered inbox-category criteria', () => {
  const decision = buildInboxDecisionInput({ ...inbound, labels: ['INBOX', 'CATEGORY_PROMOTIONS'], subject: 'Urgent: 50% off', body: 'Limited offer', from: 'shop@example.com' });
  expect(decision.questions[INBOX_CATEGORY_QUESTION]).toEqual({
    type: 'choice',
    instructions: INBOX_CATEGORY_INSTRUCTIONS,
    criteria: { ...INBOX_CATEGORY_CRITERIA },
  });
  expect(decision.state).toContain('Subject: Urgent: 50% off');
  expect(decision.state).toContain('Labels: INBOX, CATEGORY_PROMOTIONS');
  expect(decision.state).toContain('hints only');
  expect(Object.keys(decision.questions[INBOX_CATEGORY_QUESTION]!.criteria)).toEqual(['purchases', 'urgent', 'important', 'filtered']);
});

test('maps Jev choices onto Signal categories including OTP mail as Important', async () => {
  const decisions: unknown[] = [];
  const classify = (choice: 'purchases' | 'urgent' | 'important' | 'filtered', input = inbound) => classifyEmailWithFallback('team', input, async (_team, decision) => {
    decisions.push(decision);
    return { answers: { [INBOX_CATEGORY_QUESTION]: { type: 'choice' as const, choice } } };
  });
  expect(inboxCategoryFor(['INBOX'], await classify('purchases'))).toBe('Purchases');
  expect(inboxCategoryFor(['INBOX'], await classify('urgent'))).toBe('Urgent');
  expect(inboxCategoryFor(['INBOX'], await classify('important', { ...inbound, subject: 'Your verification code is 482191', from: 'noreply@id.example.com', body: 'Use 482191 to sign in.' }))).toBe('Important');
  expect(inboxCategoryFor(['INBOX'], await classify('filtered', { ...inbound, labels: ['INBOX', 'CATEGORY_PROMOTIONS'], subject: 'Sale', body: 'Limited offer' }))).toBe('Filtered');
  expect(classificationForInboxChoice('important', { ...inbound, subject: 'Your verification code is 482191', from: 'noreply@id.example.com', body: 'Use 482191 to sign in.' })).toMatchObject({ priority: 'normal', state: 'needs_action', isPurchase: false });
  expect(decisions[0]).toMatchObject({ questions: { [INBOX_CATEGORY_QUESTION]: { type: 'choice' } } });
});

test('skips Jev for Spam and Trash and defaults invalid decisions to Important', async () => {
  let called = 0;
  const decide = async () => { called += 1; return { answers: { [INBOX_CATEGORY_QUESTION]: { type: 'choice' as const, choice: 'important' } } }; };
  expect(await classifyEmailWithFallback('team', { ...inbound, labels: ['SPAM'], subject: 'Prize' }, decide)).toMatchObject({ state: 'filtered' });
  expect(await classifyEmailWithFallback('team', { ...inbound, labels: ['TRASH'], subject: 'Old receipt' }, decide)).toMatchObject({ state: 'filtered' });
  expect(called).toBe(0);
  expect(await classifyEmailWithFallback('team', inbound, async () => ({ answers: { [INBOX_CATEGORY_QUESTION]: { type: 'choice', choice: 'unknown' } } }))).toMatchObject({ priority: 'normal', state: 'needs_action', isPurchase: false });
  expect(await classifyEmailWithFallback('team', inbound, async () => { throw new Error('unavailable'); })).toMatchObject({ priority: 'normal', state: 'needs_action', isPurchase: false });
});
