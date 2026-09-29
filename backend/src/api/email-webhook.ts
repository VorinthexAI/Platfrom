export const GMAIL_WEBHOOK_V1_PATH = '/webhooks/gmail';
export function isGmailWebhookPath(path: string) {
  return path === GMAIL_WEBHOOK_V1_PATH || path.startsWith(`${GMAIL_WEBHOOK_V1_PATH}/`);
}
export async function handleGmailWebhook() { return new Response('retired', { status: 404 }); }
