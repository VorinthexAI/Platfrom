import { sendBrandedEmail, type BrandedEmailInput } from './service';

export const OPEN_APP_URL = 'https://vorinthex.com/open';

export interface CommerceEmailRecipient {
  email: string;
  name?: string | null;
}

interface PaidCommerceEmailInput extends CommerceEmailRecipient {
  amountCents: number;
  billingPeriod?: 'week' | 'month' | null;
  grantMicroSparks: number;
}

interface SubscriptionCancellationEmailInput extends CommerceEmailRecipient { currentPeriodEnd?: string | null }

function escapeHtml(value: string) {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');
}

function greeting(name?: string | null) {
  const trimmed = name?.trim();
  return trimmed ? `Hi ${escapeHtml(trimmed)}, ` : '';
}

function formatUsd(amountCents: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amountCents / 100);
}

function formatSparks(microSparks: number) {
  return new Intl.NumberFormat('en-US').format(microSparks / 1_000_000);
}

function formatDate(value?: string | null) {
  return value ? new Intl.DateTimeFormat('en-US', { dateStyle: 'long', timeZone: 'UTC' }).format(new Date(value)) : null;
}

function commerceEmail(input: CommerceEmailRecipient, content: Pick<BrandedEmailInput, 'subject' | 'preheader' | 'eyebrow' | 'headline' | 'bodyHtml' | 'footerHtml'>): BrandedEmailInput {
  return { to: input.email, label: 'Vorinthex AI', actionUrl: OPEN_APP_URL, actionLabel: 'Open app', ...content };
}

export function welcomeEmailInput(to: string): BrandedEmailInput {
  return {
    to,
    subject: 'Welcome to Vorinthex AI',
    preheader: 'Access your personal AI agent now.',
    label: 'Vorinthex AI',
    eyebrow: 'Welcome',
    headline: 'Welcome to Vorinthex AI.',
    bodyHtml: 'Access your personal AI agent now.',
    actionUrl: OPEN_APP_URL,
    actionLabel: 'Open app',
    footerHtml: 'You received this email because a Vorinthex AI account was created with this address.',
  };
}

export function accountDeletedEmailInput(to: string): BrandedEmailInput {
  return {
    to,
    subject: 'Your Vorinthex account has been deleted',
    preheader: 'Your account deletion is complete.',
    label: 'Vorinthex AI',
    eyebrow: 'Account deleted',
    headline: 'Your account has been deleted.',
    bodyHtml: 'Your Vorinthex AI account and the data associated with it have been permanently deleted.',
    footerHtml: 'This is a confirmation of the account deletion you requested.',
  };
}

export function topUpPurchaseEmailInput(input: PaidCommerceEmailInput): BrandedEmailInput {
  return commerceEmail(input, {
    subject: 'Your Vorinthex top-up is confirmed',
    preheader: 'Your one-time top-up is ready.',
    eyebrow: 'Purchase confirmed',
    headline: 'Your top-up is ready.',
    bodyHtml: `${greeting(input.name)}Your one-time top-up of ${formatUsd(input.amountCents)} is complete. ${formatSparks(input.grantMicroSparks)} Sparks are available now.`,
    footerHtml: 'You received this email because a one-time purchase was completed for your Vorinthex AI account.',
  });
}

export function subscriptionPurchaseEmailInput(input: PaidCommerceEmailInput): BrandedEmailInput {
  const cadence = input.billingPeriod ? ` per ${input.billingPeriod}` : '';
  return commerceEmail(input, {
    subject: 'Your Vorinthex subscription is active',
    preheader: 'Your subscription purchase is confirmed.',
    eyebrow: 'Subscription active',
    headline: 'Your subscription is active.',
    bodyHtml: `${greeting(input.name)}Your subscription purchase of ${formatUsd(input.amountCents)}${cadence} is confirmed, with ${formatSparks(input.grantMicroSparks)} Sparks added to your balance.`,
    footerHtml: 'You received this email because a subscription was purchased for your Vorinthex AI account.',
  });
}

export function subscriptionRenewalEmailInput(input: PaidCommerceEmailInput): BrandedEmailInput {
  return commerceEmail(input, {
    subject: 'Your Vorinthex subscription has renewed',
    preheader: 'Your subscription renewal is confirmed.',
    eyebrow: 'Subscription renewed',
    headline: 'Your subscription has renewed.',
    bodyHtml: `${greeting(input.name)}Your subscription renewed successfully for ${formatUsd(input.amountCents)}, with ${formatSparks(input.grantMicroSparks)} Sparks added to your balance.`,
    footerHtml: 'You received this email because a subscription renewed for your Vorinthex AI account.',
  });
}

export function subscriptionCancellationEmailInput(input: SubscriptionCancellationEmailInput): BrandedEmailInput {
  const endDate = formatDate(input.currentPeriodEnd);
  return commerceEmail(input, {
    subject: 'Your Vorinthex subscription cancellation is scheduled',
    preheader: 'Your subscription will end after the current billing period.',
    eyebrow: 'Cancellation scheduled',
    headline: 'Your cancellation is scheduled.',
    bodyHtml: `${greeting(input.name)}Your subscription will remain active until ${endDate ?? 'the end of your current billing period'}, then it will be canceled.`,
    footerHtml: 'You received this email because cancellation was scheduled for your Vorinthex AI subscription.',
  });
}

export async function sendWelcomeEmail(to: string) { await sendBrandedEmail(welcomeEmailInput(to)); }
export async function sendAccountDeletedEmail(to: string) { await sendBrandedEmail(accountDeletedEmailInput(to)); }
export async function sendTopUpPurchaseEmail(input: PaidCommerceEmailInput) { await sendBrandedEmail(topUpPurchaseEmailInput(input)); }
export async function sendSubscriptionPurchaseEmail(input: PaidCommerceEmailInput) { await sendBrandedEmail(subscriptionPurchaseEmailInput(input)); }
export async function sendSubscriptionRenewalEmail(input: PaidCommerceEmailInput) { await sendBrandedEmail(subscriptionRenewalEmailInput(input)); }
export async function sendSubscriptionCancellationEmail(input: SubscriptionCancellationEmailInput) { await sendBrandedEmail(subscriptionCancellationEmailInput(input)); }
