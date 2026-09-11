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
  actionUrl?: string;
  actionLabel?: string;
  supportingHtml?: string;
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

type EmailEnvironment = Partial<Pick<NodeJS.ProcessEnv, 'NODE_ENV' | 'SMTP_HOST' | 'SMTP_PORT' | 'SMTP_USER' | 'SMTP_PASS' | 'NO_REPLY_EMAIL'>>;

export function resolveSmtpConfiguration(environment: EmailEnvironment) {
  const host = environment.SMTP_HOST?.trim();
  const rawPort = environment.SMTP_PORT?.trim();
  const user = environment.SMTP_USER?.trim();
  const pass = environment.SMTP_PASS;
  const from = environment.NO_REPLY_EMAIL?.trim();
  const configured = Boolean(host || rawPort || user || pass);

  if (!configured && environment.NODE_ENV !== 'production') return null;

  const port = Number(rawPort ?? 587);
  if (!host || !Number.isInteger(port) || port < 1 || port > 65_535 || !user || !pass || !from) {
    throw new Error('SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, and NO_REPLY_EMAIL are required when SMTP delivery is configured');
  }
  return { host, port, user, pass, from };
}

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
  let template = input.actionUrl && input.actionLabel
    ? getTemplate()
    : getTemplate().replaceAll(/\s*<!-- action:start -->[\s\S]*?<!-- action:end -->/g, '');
  if (!input.supportingHtml) template = template.replaceAll(/\s*<!-- supporting:start -->[\s\S]*?<!-- supporting:end -->/g, '');
  template = template.replaceAll(/\s*<!-- (?:action|supporting):(?:start|end) -->\s*/g, '');
  return replaceAll(template, {
    subject: input.subject,
    preheader: input.preheader,
    label: input.label,
    eyebrow: input.eyebrow,
    headline: input.headline,
    body_html: input.bodyHtml,
    action_url: input.actionUrl ?? '',
    action_label: input.actionLabel ?? '',
    supporting_html: input.supportingHtml ?? '',
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
  const smtp = resolveSmtpConfiguration(process.env);
  if (!smtp) {
    console.log(`Vorinthex email to ${input.to}${input.logUrl ? `: ${input.logUrl}` : ''}`);
    return;
  }

  const transporter = nodemailer.createTransport({
    host: smtp.host,
    port: smtp.port,
    secure: smtp.port === 465,
    auth: { user: smtp.user, pass: smtp.pass },
  });

  await transporter.sendMail({
    from: input.from ?? smtp.from,
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
