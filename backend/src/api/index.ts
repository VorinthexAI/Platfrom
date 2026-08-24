import { serve } from 'bun';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { websocket } from 'hono/bun';
import { errorHandler } from './errors';
import { autoRefreshAuthTokens, rateLimitByIp, requestLogger, requireEnvApiKey, validateQueryParams } from './middleware';
import { handleResendWebhook, RESEND_WEBHOOK_V1_PATH } from './resend';
import { GMAIL_WEBHOOK_V1_PATH, handleGmailWebhook } from './email-webhook';
import { closeEmailSyncQueue, enqueueEmailConnectorPolling, enqueueEmailWatchRenewal, startEmailSyncWorker } from '@/lib/email-inbox/sync-queue';
import { closeGalleryUploadQueue, recoverGalleryUploadQueue, startGalleryUploadWorker } from '@/lib/gallery/upload-queue';
import { registerRoutes } from './routes';
import { drainStorageDeletionJobs } from '@/lib/storage-deletion';

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
    idleTimeout: 120,
    websocket,
  });
  console.log(`vorinthex app listening on ${port}`);
  const emailWorker = startEmailSyncWorker();
  const galleryWorker = startGalleryUploadWorker();
  void recoverGalleryUploadQueue().catch((error) => console.error('gallery upload queue recovery failed', { error }));
  void drainStorageDeletionJobs(1000).catch((error) => console.error('storage deletion recovery failed', { error }));
  void enqueueEmailWatchRenewal().catch((error) => console.error('email watch renewal enqueue failed', { error }));
  void enqueueEmailConnectorPolling().catch((error) => console.error('email connector polling enqueue failed', { error }));
  const storageDeletionTimer = setInterval(() => { void drainStorageDeletionJobs(1000).catch((error) => console.error('storage deletion recovery failed', { error })); }, 60_000);
  const renewalTimer = setInterval(() => { void enqueueEmailWatchRenewal().catch((error) => console.error('email watch renewal enqueue failed', { error })); }, 6 * 60 * 60_000);
  const emailPollingTimer = setInterval(() => { void enqueueEmailConnectorPolling().catch((error) => console.error('email connector polling enqueue failed', { error })); }, 5 * 60_000);

  const shutdown = async () => {
    clearInterval(storageDeletionTimer);
    clearInterval(renewalTimer);
    clearInterval(emailPollingTimer);
    await emailWorker.close();
    await galleryWorker.close();
    await closeEmailSyncQueue();
    await closeGalleryUploadQueue();
    server.stop();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}
