import { describe, expect, test } from 'bun:test';
import { renderBrandedEmail, renderMarketingEmail } from './email';

describe('email rendering', () => {
  test('renders the shared transactional email layout', () => {
    const html = renderBrandedEmail({
      to: 'person@example.com',
      subject: 'Test email',
      preheader: 'Preview text',
      label: 'Test',
      eyebrow: 'Eyebrow',
      headline: 'Headline',
      bodyHtml: 'Body copy',
      actionUrl: 'https://app.example.com/action',
      actionLabel: 'Act now',
      supportingHtml: 'Support copy',
      footerHtml: 'Footer copy',
    });

    expect(html).toContain('<title>Test email</title>');
    expect(html).toContain('Headline');
    expect(html).toContain('https://app.example.com/action');
    expect(html).toContain('vtx-button-wrap');
    expect(html).toContain('box-sizing:border-box');
    const buttonCss = html.match(/\.vtx-button\s*\{([^}]*)\}/)?.[1] ?? '';
    const buttonDeclarations = buttonCss.split(';').map((value) => value.trim());
    expect(buttonDeclarations).not.toContain('width: 100% !important');
    expect(html).not.toContain('{{subject}}');
  });

  test('renders the marketing email layout without a CTA button', () => {
    const html = renderMarketingEmail({
      to: 'person@example.com',
      subject: 'Update',
      preheader: 'Preview text',
      label: 'Update',
      eyebrow: 'Stealth mode',
      headline: 'A quiet signal',
      bodyHtml: 'Body copy',
      footerHtml: 'Footer copy',
      unsubscribeUrl: 'https://app.example.com/public/updates/unsubscribe?token_hash=abc',
    });

    expect(html).toContain('<title>Update</title>');
    expect(html).toContain('A quiet signal');
    expect(html).toContain('Unsubscribe here');
    expect(html).toContain('https://app.example.com/public/updates/unsubscribe?token_hash=abc');
    expect(html).not.toContain('{{action_url}}');
    expect(html).not.toContain('vtx-button');
  });
});
