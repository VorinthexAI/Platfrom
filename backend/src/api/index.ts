import { serve } from 'bun';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { websocket } from 'hono/bun';
import { errorHandler } from './errors';
import { autoRefreshAuthTokens, bindEventApp, rateLimitByIp, requestLogger, requireEnvApiKey, validateQueryParams } from './middleware';
import { handleResendWebhook, RESEND_WEBHOOK_V1_PATH } from './resend';
import { GMAIL_WEBHOOK_V1_PATH, handleGmailWebhook } from './email-webhook';
import { closeEmailSyncQueue, enqueueEmailWatchRenewal, recoverEmailSyncQueue, startEmailSyncWorker } from '@/lib/email-inbox/sync-queue';
import { closeGalleryUploadQueue, recoverGalleryUploadQueue, startGalleryUploadWorker } from '@/lib/gallery/upload-queue';
import { registerRoutes } from './routes';
import { closeConversationImageTurnQueue, recoverConversationImageTurnQueue, startConversationImageTurnWorker } from '@/lib/conversations/image-turn-queue';
import { closeAutomations, startAutomations } from '@/lib/automations';
import { closeBookRefundWorker, startBookRefundWorker } from '@/lib/books/refund-worker';
import { defaultBookService } from '@/lib/books/default-service';

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
    'X-Vorinthex-App-Key',
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
app.use('*', bindEventApp);
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
  const conversationImageWorker = startConversationImageTurnWorker();
  startBookRefundWorker();
  void startAutomations().catch((error) => console.error('automation startup failed', { error }));
  void recoverGalleryUploadQueue().catch((error) => console.error('gallery upload queue recovery failed', { error }));
  void enqueueEmailWatchRenewal().catch((error) => console.error('email watch renewal enqueue failed', { error }));
  void recoverEmailSyncQueue().catch((error) => console.error('email synchronization queue recovery failed', { error }));
  void recoverConversationImageTurnQueue().catch((error) => console.error('conversation image queue recovery failed', { error }));
  void defaultBookService.recoverGenerations().catch((error) => console.error('book generation recovery failed', { error }));
  const renewalTimer = setInterval(() => { void enqueueEmailWatchRenewal().catch((error) => console.error('email watch renewal enqueue failed', { error })); }, 6 * 60 * 60_000);
  const emailRecoveryTimer = setInterval(() => { void recoverEmailSyncQueue().catch((error) => console.error('email synchronization queue recovery failed', { error })); }, 60_000);
  const conversationImageRecoveryTimer = setInterval(() => { void recoverConversationImageTurnQueue().catch((error) => console.error('conversation image queue recovery failed', { error })); }, 60_000);
  const bookGenerationRecoveryTimer = setInterval(() => { void defaultBookService.recoverGenerations().catch((error) => console.error('book generation recovery failed', { error })); }, 60_000);

  let shuttingDown = false;
  const shutdown = async () => {
    if (shuttingDown) return;
    shuttingDown = true;
    server.stop(false);
    clearInterval(renewalTimer);
    clearInterval(emailRecoveryTimer);
    clearInterval(conversationImageRecoveryTimer);
    clearInterval(bookGenerationRecoveryTimer);
    await emailWorker.close();
    await galleryWorker.close();
    await conversationImageWorker.close();
    await closeEmailSyncQueue();
    await closeGalleryUploadQueue();
    await closeConversationImageTurnQueue();
    await closeBookRefundWorker();
    await closeAutomations();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}
