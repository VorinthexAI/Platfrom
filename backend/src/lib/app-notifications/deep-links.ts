export const MANAGED_INBOX_DEEP_LINK_PATH = '/capability/signal';

export function managedInboxDeepLinkUrl(environment: NodeJS.ProcessEnv = process.env) {
  const origin = (environment.FRONTEND_URL ?? environment.FRONTEND_AUTH_URL ?? '').trim().replace(/\/$/, '');
  if (!origin) throw new Error('FRONTEND_URL is required for managed inbox deep links.');
  return new URL(MANAGED_INBOX_DEEP_LINK_PATH, `${origin}/`).toString();
}
