import { serve } from 'bun';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { websocket } from 'hono/bun';
import { errorHandler } from './errors';
import { autoRefreshAuthTokens, rateLimitByIp, requestLogger, requireEnvApiKey, validateQueryParams } from './middleware';
import { handleResendWebhook, RESEND_WEBHOOK_V1_PATH } from './resend';
import { GMAIL_WEBHOOK_V1_PATH, handleGmailWebhook } from './email-webhook';
import { closeEmailSyncQueue, enqueueEmailWatchRenewal, startEmailSyncWorker } from '@/lib/email-inbox/sync-queue';
import { registerRoutes } from './routes';

export const app = new Hono();
const api = app.basePath('/api/v1');
const DEFAULT_PROD_CORS_ORIGINS = ['https://vorinthex.com'];

app.use('*', cors({
  origin: (origin) => {
    const configuredOrigins = (process.env.CORS_ORIGINS ?? DEFAULT_PROD_CORS_ORIGINS.join(','))
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean);
    if (configuredOrigins.includes(origin)) return origin;
    if (process.env.NODE_ENV !== 'production' && /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) {
      return origin;
    }
    return configuredOrigins[0] ?? '';
  },
  credentials: true,
  allowMethods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
  allowHeaders: [
    'Authorization',
    'Content-Type',
    'Idempotency-Key',
    'X-API-Key',
    'X-Vorinthex-API-Key',
    'X-Vorinthex-Session-Transport',
    'X-Refresh-Token',
    'svix-id',
    'svix-timestamp',
    'svix-signature',
  ],
  exposeHeaders: ['WWW-Authenticate', 'X-Access-Token', 'X-Refresh-Token', 'X-Access-Token-Max-Age', 'X-Refresh-Token-Max-Age'],
}));
app.use('*', requestLogger);
app.use('*', rateLimitByIp);
app.use('*', requireEnvApiKey);
app.use('*', autoRefreshAuthTokens);
app.use('*', validateQueryParams);
app.onError(errorHandler);
api.get('/health', (c) => c.json({ ok: true }));
registerRoutes(api);
app.post(RESEND_WEBHOOK_V1_PATH, handleResendWebhook);
app.post(`${RESEND_WEBHOOK_V1_PATH}/`, handleResendWebhook);
app.post(GMAIL_WEBHOOK_V1_PATH, handleGmailWebhook);
app.post(`${GMAIL_WEBHOOK_V1_PATH}/`, handleGmailWebhook);

if (import.meta.main) {
  const port = Number(process.env.PORT ?? 3001);
  const server = serve({
    hostname: '0.0.0.0',
    port,
    fetch: app.fetch,
    websocket,
  });
  console.log(`vorinthex app listening on ${port}`);
  const emailWorker = startEmailSyncWorker();
  void enqueueEmailWatchRenewal().catch((error) => console.error('email watch renewal enqueue failed', { error }));
  const renewalTimer = setInterval(() => { void enqueueEmailWatchRenewal().catch((error) => console.error('email watch renewal enqueue failed', { error })); }, 6 * 60 * 60_000);

  const shutdown = async () => {
    clearInterval(renewalTimer);
    await emailWorker.close();
    await closeEmailSyncQueue();
    server.stop();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}
