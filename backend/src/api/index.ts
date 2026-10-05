import { serve } from 'bun';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { websocket } from 'hono/bun';
import { z } from 'zod';
import { errorHandler } from './errors';
import { autoRefreshAuthTokens, bindDevice, bindEventApp, bindEventIdentifier, ipRateLimit, requestLogger, requireEnvApiKey, validateQueryParams } from './middleware';
import { EVENT_IDENTIFIER_HEADER } from '@/lib/ai/events/event-identifier';
import { DEVICE_IDENTIFIER_HEADER } from '@/lib/ai/events/device';
import { handleResendWebhook, RESEND_WEBHOOK_V1_PATH } from './resend';
import { registerRoutes } from './routes';
import { closeConversationImageTurnQueue, recoverConversationImageTurnQueue, startConversationImageTurnWorker } from '@/lib/conversations/image-turn-queue';
import { closeConversationAttachmentPersistenceQueue, recoverConversationAttachmentPersistenceQueue, startConversationAttachmentPersistenceWorker } from '@/lib/conversations/attachment-persistence-queue';
import { closeAutomations, startAutomations } from '@/lib/automations';
import { handlePolarWebhook, POLAR_WEBHOOK_V1_PATH } from './polar-webhook';
import { polarConfiguration } from '@/lib/commerce/polar';
import { closeAppNotificationQueue, recoverAppNotificationQueue, startAppNotificationWorker } from '@/lib/app-notifications/queue';
import { closeConversationArchiveProjectionQueue, recoverConversationArchiveProjectionQueue, startConversationArchiveProjectionWorker } from '@/lib/conversations/archive-projection-queue';

export const app = new Hono();
const api = app.basePath('/api/v1');
const DEFAULT_PROD_CORS_ORIGINS = ['https://vorinthex.com'];
const storeUrl = z.string().url().startsWith('https://');
const appUpdate = z.object({
  appVersion: z.string().regex(/^\d+\.\d+\.\d+$/),
  playStoreUrl: storeUrl.nullable(),
  appStoreUrl: storeUrl.nullable(),
}).parse({
  appVersion: process.env.APP_VERSION ?? '1.0.0',
  playStoreUrl: process.env.PLAY_STORE_URL?.trim() || null,
  appStoreUrl: process.env.APP_STORE_URL?.trim() || null,
});

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
  allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowHeaders: [
    'Authorization',
    'Content-Type',
    'Idempotency-Key',
    'X-API-Key',
    'X-Vorinthex-API-Key',
    'X-Vorinthex-Session-Transport',
    'X-Vorinthex-App-Key',
    EVENT_IDENTIFIER_HEADER,
    DEVICE_IDENTIFIER_HEADER,
    'X-Refresh-Token',
    'svix-id',
    'svix-timestamp',
    'svix-signature',
    'webhook-id',
    'webhook-timestamp',
    'webhook-signature',
  ],
  exposeHeaders: ['WWW-Authenticate', 'X-Access-Token', 'X-Refresh-Token', 'X-Access-Token-Max-Age', 'X-Refresh-Token-Max-Age', 'RateLimit-Limit', 'RateLimit-Remaining', 'RateLimit-Reset', 'RateLimit-Policy', 'Retry-After'],
}));
app.use('*', bindEventIdentifier);
app.use('*', bindDevice);
app.use('*', requestLogger);
app.use('*', ipRateLimit);
app.use('*', requireEnvApiKey);
app.use('*', bindEventApp);
app.use('*', autoRefreshAuthTokens);
app.use('*', validateQueryParams);
app.onError(errorHandler);
api.get('/health', (c) => c.json(c.req.query('appUpdate') === '1' ? { ok: true, ...appUpdate } : { ok: true }));
registerRoutes(api);
app.post(RESEND_WEBHOOK_V1_PATH, handleResendWebhook);
app.post(`${RESEND_WEBHOOK_V1_PATH}/`, handleResendWebhook);
app.post(POLAR_WEBHOOK_V1_PATH, handlePolarWebhook);
app.post(`${POLAR_WEBHOOK_V1_PATH}/`, handlePolarWebhook);

if (import.meta.main) {
  if (process.env.NODE_ENV === 'production') {
    polarConfiguration();
    if (!process.env.POLAR_WEBHOOK_SECRET?.trim()) throw new Error('POLAR_WEBHOOK_SECRET is required in production.');
  }
  await startAutomations();
  const port = Number(process.env.PORT ?? 3001);
  const server = serve({
    hostname: '0.0.0.0',
    port,
    fetch: app.fetch,
    idleTimeout: 120,
    websocket,
  });
  console.log(`vorinthex app listening on ${port}`);
  const conversationImageWorker = startConversationImageTurnWorker();
  const conversationAttachmentWorker = startConversationAttachmentPersistenceWorker();
  const conversationArchiveWorker = startConversationArchiveProjectionWorker();
  const appNotificationWorker = startAppNotificationWorker();
  void recoverConversationImageTurnQueue().catch((error) => console.error('conversation image queue recovery failed', { error }));
  void recoverConversationAttachmentPersistenceQueue().catch((error) => console.error('conversation attachment persistence queue recovery failed', { error }));
  void recoverConversationArchiveProjectionQueue().catch((error) => console.error('conversation archive projection queue recovery failed', { error }));
  void recoverAppNotificationQueue().catch((error) => console.error('app notification queue recovery failed', { error }));
  const conversationImageRecoveryTimer = setInterval(() => { void recoverConversationImageTurnQueue().catch((error) => console.error('conversation image queue recovery failed', { error })); }, 60_000);
  const conversationAttachmentRecoveryTimer = setInterval(() => { void recoverConversationAttachmentPersistenceQueue().catch((error) => console.error('conversation attachment persistence queue recovery failed', { error })); }, 60_000);
  const conversationArchiveRecoveryTimer = setInterval(() => { void recoverConversationArchiveProjectionQueue().catch((error) => console.error('conversation archive projection queue recovery failed', { error })); }, 60_000);

  let shuttingDown = false;
  const shutdown = async () => {
    if (shuttingDown) return;
    shuttingDown = true;
    server.stop(false);
    clearInterval(conversationImageRecoveryTimer);
    clearInterval(conversationAttachmentRecoveryTimer);
    clearInterval(conversationArchiveRecoveryTimer);
    await conversationImageWorker.close();
    await conversationAttachmentWorker.close();
    await conversationArchiveWorker.close();
    await appNotificationWorker.close();
    await closeConversationImageTurnQueue();
    await closeConversationAttachmentPersistenceQueue();
    await closeConversationArchiveProjectionQueue();
    await closeAppNotificationQueue();
    await closeAutomations();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}
