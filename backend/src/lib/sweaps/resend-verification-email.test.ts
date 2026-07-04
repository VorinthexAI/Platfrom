import { describe, expect, test } from 'bun:test';
import { resendVerificationEmailSweep } from './resend-verification-email';

describe('resendVerificationEmailSweep', () => {
  test('continues sending when one recipient fails', async () => {
    const users = [
      { key: 'usr_1', email: 'bad@example.com', name: 'Bad' },
      { key: 'usr_2', email: 'good@example.com', name: 'Good' },
    ] as any;
    const sent: string[] = [];

    const result = await resendVerificationEmailSweep({
      listUsers: async () => users,
      sendEmail: async (user) => {
        if (user.email === 'bad@example.com') throw new Error('smtp hard bounce');
        sent.push(user.email);
        return {
          verifyLink: 'https://app.example.com/public/waitlist/verify?token_hash=abc',
          expiresAt: new Date('2026-07-04T12:00:00.000Z'),
        };
      },
    });

    expect(sent).toEqual(['good@example.com']);
    expect(result.sent).toBe(1);
    expect(result.failed).toBe(1);
    expect(result.users).toEqual([{ ok: true, userId: 'usr_2', email: 'good@example.com' }]);
    expect(result.failures).toEqual([{ ok: false, userId: 'usr_1', email: 'bad@example.com', error: 'smtp hard bounce' }]);
  });
});
