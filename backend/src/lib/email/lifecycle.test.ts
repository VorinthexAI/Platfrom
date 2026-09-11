import { describe, expect, test } from 'bun:test';
import { renderBrandedEmail } from './service';
import { accountDeletedEmailInput, OPEN_APP_URL, subscriptionCancellationEmailInput, subscriptionPurchaseEmailInput, subscriptionRenewalEmailInput, topUpPurchaseEmailInput, welcomeEmailInput } from './lifecycle';

describe('account lifecycle emails', () => {
  test('renders a thin welcome email with the universal app link', () => {
    const input = welcomeEmailInput('person@example.com');
    const html = renderBrandedEmail(input);
    expect(input).toMatchObject({ to: 'person@example.com', actionLabel: 'Open app', actionUrl: OPEN_APP_URL });
    expect(html).toContain('Welcome to Vorinthex AI.');
    expect(html).toContain('Access your personal AI agent now.');
    expect(html).toContain('https://vorinthex.com/open');
    expect(html).toContain('vtx-button');
    expect(html).not.toContain('Core is available from the bottom');
    expect(html).not.toContain('supporting:start');
  });

  test('renders deletion confirmation without any CTA or fallback action link', () => {
    const input = accountDeletedEmailInput('person@example.com');
    const html = renderBrandedEmail(input);
    expect(input.actionUrl).toBeUndefined();
    expect(input.actionLabel).toBeUndefined();
    expect(html).toContain('Your account has been deleted.');
    expect(html).not.toContain('vtx-button-wrap');
    expect(html).not.toContain('If the button does not work');
    expect(html).not.toContain('{{action_url}}');
    expect(html).not.toContain('No further action is required.');
    expect(html).not.toContain('supporting:start');
  });
});

describe('commerce lifecycle emails', () => {
  test('renders each confirmation with branded copy and the universal app CTA', () => {
    const inputs = [
      topUpPurchaseEmailInput({ email: 'person@example.com', name: 'Ada', amountCents: 999, grantMicroSparks: 200_000_000 }),
      subscriptionPurchaseEmailInput({ email: 'person@example.com', name: 'Ada', amountCents: 799, billingPeriod: 'week', grantMicroSparks: 200_000_000 }),
      subscriptionRenewalEmailInput({ email: 'person@example.com', name: 'Ada', amountCents: 799, grantMicroSparks: 200_000_000 }),
      subscriptionCancellationEmailInput({ email: 'person@example.com', name: 'Ada', currentPeriodEnd: '2026-10-01T00:00:00.000Z' }),
    ];

    for (const input of inputs) {
      const html = renderBrandedEmail(input);
      expect(input).toMatchObject({ to: 'person@example.com', actionLabel: 'Open app', actionUrl: OPEN_APP_URL });
      expect(html).toContain('Hi Ada,');
      expect(html).toContain('https://vorinthex.com/open');
      expect(html).toContain('vtx-button');
    }
    expect(inputs[0]?.bodyHtml).toContain('$9.99');
    expect(inputs[0]?.bodyHtml).toContain('200 Sparks');
    expect(inputs[1]?.bodyHtml).toContain('$7.99 per week');
    expect(inputs[2]?.headline).toContain('renewed');
    expect(inputs[3]?.headline).toContain('cancellation is scheduled');
    expect(inputs[3]?.bodyHtml).toContain('October 1, 2026');
  });

  test('omits a missing name and escapes an available name', () => {
    expect(topUpPurchaseEmailInput({ email: 'person@example.com', amountCents: 999, grantMicroSparks: 200_000_000 }).bodyHtml).not.toContain('Hi ');
    expect(subscriptionRenewalEmailInput({ email: 'person@example.com', name: '<Ada & Co>', amountCents: 799, grantMicroSparks: 200_000_000 }).bodyHtml).toContain('Hi &lt;Ada &amp; Co&gt;,');
  });
});
