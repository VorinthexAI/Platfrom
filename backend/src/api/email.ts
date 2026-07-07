import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import nodemailer from 'nodemailer';

export interface BrandedEmailInput {
  from?: string;
  to: string;
  subject: string;
  preheader: string;
  label: string;
  eyebrow: string;
  headline: string;
  bodyHtml: string;
  actionUrl: string;
  actionLabel: string;
  supportingHtml: string;
  footerHtml: string;
  extraPayload?: Record<string, unknown>;
}

export interface MarketingEmailInput {
  from?: string;
  to: string;
  subject: string;
  preheader: string;
  label: string;
  eyebrow: string;
  headline: string;
  bodyHtml: string;
  footerHtml: string;
  unsubscribeUrl: string;
  extraPayload?: Record<string, unknown>;
}

const sharedRoot = process.env.SHARED_DIR ?? join(process.cwd(), '..', 'shared');
const templatePath = join(sharedRoot, 'brand/email/default-email-layout.html');
const marketingTemplatePath = join(sharedRoot, 'brand/email/marketing-email-layout.html');
let cachedTemplate: string | null = null;
let cachedMarketingTemplate: string | null = null;

function getTemplate() {
  cachedTemplate ??= readFileSync(templatePath, 'utf8');
  return cachedTemplate;
}

function getMarketingTemplate() {
  cachedMarketingTemplate ??= readFileSync(marketingTemplatePath, 'utf8');
  return cachedMarketingTemplate;
}

function replaceAll(value: string, replacements: Record<string, string>) {
  let output = value;
  for (const [key, replacement] of Object.entries(replacements)) {
    output = output.replaceAll(`{{${key}}}`, replacement);
  }
  return output;
}

export function renderBrandedEmail(input: BrandedEmailInput) {
  return replaceAll(getTemplate(), {
    subject: input.subject,
    preheader: input.preheader,
    label: input.label,
    eyebrow: input.eyebrow,
    headline: input.headline,
    body_html: input.bodyHtml,
    action_url: input.actionUrl,
    action_label: input.actionLabel,
    supporting_html: input.supportingHtml,
    footer_html: input.footerHtml,
  });
}

export function renderMarketingEmail(input: MarketingEmailInput) {
  return replaceAll(getMarketingTemplate(), {
    subject: input.subject,
    preheader: input.preheader,
    label: input.label,
    eyebrow: input.eyebrow,
    headline: input.headline,
    body_html: input.bodyHtml,
    footer_html: input.footerHtml,
    unsubscribe_html: `No longer want these updates? <a href="${input.unsubscribeUrl}" style="color:#aeb6bc; text-decoration:underline; word-break:break-all;">Unsubscribe here</a>.`,
  });
}

async function sendHtmlEmail(input: { from?: string; to: string; subject: string; html: string; logUrl?: string }) {
  const from = input.from ?? process.env.NO_REPLY_EMAIL;

  if (process.env.NODE_ENV !== 'production') {
    console.log(`Vorinthex email to ${input.to}${input.logUrl ? `: ${input.logUrl}` : ''}`);
    return;
  }

  const host = process.env.SMTP_HOST;
  const port = Number(process.env.SMTP_PORT ?? 587);
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;

  if (!host || !Number.isInteger(port) || !user || !pass || !from) {
    throw new Error('SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, and NO_REPLY_EMAIL are required in production');
  }

  const transporter = nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: { user, pass },
  });

  await transporter.sendMail({
    from,
    to: input.to,
    subject: input.subject,
    html: input.html,
  });
}

export async function sendBrandedEmail(input: BrandedEmailInput) {
  await sendHtmlEmail({
    from: input.from,
    to: input.to,
    subject: input.subject,
    html: renderBrandedEmail(input),
    logUrl: input.actionUrl,
  });
}

export async function sendMarketingEmail(input: MarketingEmailInput) {
  await sendHtmlEmail({
    from: input.from,
    to: input.to,
    subject: input.subject,
    html: renderMarketingEmail(input),
    logUrl: input.unsubscribeUrl,
  });
}
