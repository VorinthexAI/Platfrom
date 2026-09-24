import { describe, expect, test } from 'bun:test';
import { renderBrandedEmail } from './service';
import { accountDeletedEmailInput, OPEN_APP_URL, signInEmailInput, subscriptionCancellationEmailInput, subscriptionPurchaseEmailInput, subscriptionRenewalEmailInput, topUpPurchaseEmailInput, welcomeEmailInput } from './lifecycle';

describe('account lifecycle emails', () => {
  test('renders a thin welcome email with the universal app link', () => {
    const input = welcomeEmailInput('person@example.com');
    const html = renderBrandedEmail(input);
    expect(input).toMatchObject({ to: 'person@example.com', label: '', actionLabel: 'Open app', actionUrl: OPEN_APP_URL });
    expect(html).toContain('Welcome to Vorinthex AI.');
    expect(html).toContain('Access your personal AI agent now.');
    expect(html).toContain('https://vorinthex.com/open');
    expect(html).toContain('vtx-button');
    expect(html).toContain('background-color:#000000');
    expect(html).not.toContain('Core is available from the bottom');
    expect(html).not.toContain('supporting:start');
  });

  test('renders magic-link authentication through the same branded template as welcome email', () => {
    const magicLink = 'https://vorinthex.com/public/auth/token?token_hash=abc&flow=user';
    const signInInput = signInEmailInput({ email: 'person@example.com', magicLink, expiresAt: new Date('2026-09-13T12:15:00.000Z') });
    const signInHtml = renderBrandedEmail(signInInput);
    const welcomeHtml = renderBrandedEmail(welcomeEmailInput('person@example.com'));

    for (const sharedTemplateElement of ['vtx-shell', 'vtx-button-wrap', 'vtx-button']) {
      expect(signInHtml).toContain(sharedTemplateElement);
      expect(welcomeHtml).toContain(sharedTemplateElement);
    }
    expect(signInHtml).toContain(magicLink);
    expect(signInInput.subject).toBe('Sign in to Vorinthex AI');
    expect(signInHtml).toContain('Use your secure link to sign in to Vorinthex AI.');
    expect(signInHtml).not.toContain('galaxy');
    expect(signInHtml).not.toMatch(/<td align="right"[^>]*>\s*Sign in\s*<\/td>/);
  });

  test('renders deletion confirmation without any CTA or fallback action link', () => {
    const input = accountDeletedEmailInput('person@example.com');
    const html = renderBrandedEmail(input);
    expect(input.actionUrl).toBeUndefined();
    expect(input.actionLabel).toBeUndefined();
    expect(html).toMatch(/<td align="left"[^>]*>\s*Vorinthex AI\s*<\/td>/);
    expect(html).not.toMatch(/<td align="right"[^>]*>\s*Vorinthex AI\s*<\/td>/);
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
      expect(html).toMatch(/<td align="left"[^>]*>\s*Vorinthex AI\s*<\/td>/);
      expect(html).not.toMatch(/<td align="right"[^>]*>\s*Vorinthex AI\s*<\/td>/);
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
