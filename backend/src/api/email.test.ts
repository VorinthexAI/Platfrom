import { describe, expect, test } from 'bun:test';
import { renderBrandedEmail, renderMarketingEmail, resolveSmtpConfiguration } from './email';

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
    expect(html).toContain('background-color:#030507');
    expect(html).not.toContain('background-image:linear-gradient');
    expect(html).not.toContain('background:#141922');
    expect(html).toContain('border-radius:999px');
    expect(html).toContain('color:#030507');
    expect(html).not.toContain('#faf7f2');
    expect(html).not.toContain('#8b6f47');
    expect(html).not.toContain('layout.css');
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
    expect(html).toContain('background-color:#030507');
    expect(html).not.toContain('background-image:linear-gradient');
    expect(html).not.toContain('background:#141922');
    expect(html).not.toContain('{{action_url}}');
    expect(html).not.toContain('vtx-button');
    expect(html).not.toContain('#faf7f2');
    expect(html).not.toContain('#6b6358');
  });

  test('removes transactional action blocks when no CTA is supplied', () => {
    const html = renderBrandedEmail({
      to: 'person@example.com', subject: 'Confirmation', preheader: 'Complete', label: 'Account', eyebrow: 'Complete', headline: 'Finished', bodyHtml: 'Body', supportingHtml: 'Support', footerHtml: 'Footer',
    });
    expect(html).not.toContain('vtx-button-wrap');
    expect(html).not.toContain('If the button does not work');
    expect(html).not.toContain('action:start');
    expect(html).not.toContain('supporting:start');
  });
});

describe('email delivery configuration', () => {
  test('uses configured local SMTP instead of console-only delivery', () => {
    expect(resolveSmtpConfiguration({
      NODE_ENV: 'development', SMTP_HOST: '127.0.0.1', SMTP_PORT: '1025', SMTP_USER: 'mailpit', SMTP_PASS: 'mailpit', NO_REPLY_EMAIL: 'no-reply@example.local',
    })).toEqual({ host: '127.0.0.1', port: 1025, user: 'mailpit', pass: 'mailpit', from: 'no-reply@example.local' });
  });

  test('keeps console fallback only for unconfigured non-production environments', () => {
    expect(resolveSmtpConfiguration({ NODE_ENV: 'test' })).toBeNull();
    expect(() => resolveSmtpConfiguration({ NODE_ENV: 'production' })).toThrow('SMTP_HOST');
  });
});
