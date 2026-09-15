import { expect, test } from 'bun:test';
import { newId } from '@/lib/ids';
import { issueOpeningGreetingToken, verifyOpeningGreetingToken } from './opening-greeting';

test('signs bounded opening greetings and rejects tampering or expiry', async () => {
  const currentTime = Date.parse('2026-09-01T00:00:00.000Z');
  const snapshot = { key: newId(), teamKey: 'team', scopeKey: newId(), userKey: newId(), occasion: 'returning' as const, greetingState: 'returning' as const, message: 'Welcome back.', guideTopicMode: 'recommend' as const, guideTopics: { status: 'READY' as const, topics: [1, 2, 3].map((index) => ({ key: `greeting.recommend.${index}`, label: `Topic ${index}`, question: `Question ${index}?` })) }, createdAt: '2026-09-01T00:00:00.000Z' };
  const token = await issueOpeningGreetingToken(snapshot, currentTime, 'test-secret');

  await expect(verifyOpeningGreetingToken(token, currentTime, 'test-secret')).resolves.toMatchObject(snapshot);
  await expect(verifyOpeningGreetingToken(`${token}x`, currentTime, 'test-secret')).resolves.toBeNull();
  await expect(verifyOpeningGreetingToken(token, currentTime + 24 * 60 * 60 * 1_000, 'test-secret')).resolves.toBeNull();
  await expect(verifyOpeningGreetingToken(token, currentTime, 'wrong-secret')).resolves.toBeNull();
});
