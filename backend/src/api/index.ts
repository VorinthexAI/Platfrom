import { serve } from 'bun';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { errorHandler } from './errors';
import { autoRefreshAuthTokens, rateLimitByIp, requestLogger, requireEnvApiKey, validateQueryParams } from './middleware';
import { handlePolarWebhook, POLAR_WEBHOOK_PATH } from './payments';
import { handleResendWebhook, RESEND_WEBHOOK_V1_PATH } from './resend';
import { registerRoutes } from './routes';
import { ensureLeaderboardDigestSweeper } from '@/platform/leaderboard-digest';

if (process.env.NODE_ENV === 'production' && process.env.POLAR_ACCESS_TOKEN && !process.env.POLAR_WEBHOOK_SECRET) {
  throw new Error('POLAR_WEBHOOK_SECRET is required in production when POLAR_ACCESS_TOKEN is configured');
}

export const app = new Hono();
const api = app.basePath('/api/v1');
const DEFAULT_PROD_CORS_ORIGINS = [
  'https://www.vorinthex.com',
  'https://vorinthex.com',
  'https://app.vorinthex.com',
];

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
    'X-Refresh-Token',
    'svix-id',
    'svix-timestamp',
    'svix-signature',
  ],
  exposeHeaders: ['X-Access-Token', 'X-Refresh-Token'],
}));
app.use('*', requestLogger);
app.use('*', rateLimitByIp);
app.use('*', requireEnvApiKey);
app.use('*', autoRefreshAuthTokens);
app.use('*', validateQueryParams);
app.onError(errorHandler);
api.get('/health', (c) => c.json({ ok: true }));
registerRoutes(api);
app.post(POLAR_WEBHOOK_PATH, handlePolarWebhook);
app.post(`${POLAR_WEBHOOK_PATH}/`, handlePolarWebhook);
app.post(RESEND_WEBHOOK_V1_PATH, handleResendWebhook);
app.post(`${RESEND_WEBHOOK_V1_PATH}/`, handleResendWebhook);

if (import.meta.main) {
  const port = Number(process.env.PORT ?? 3001);
  const server = serve({
    port,
    fetch: app.fetch,
  });
  console.log(`vorinthex app listening on ${port}`);

  // Daily waitlist-leaderboard digest: hourly ticks race for a Redis
  // day-lock, so exactly one instance sends per UTC day.
  ensureLeaderboardDigestSweeper();

  const shutdown = async () => {
    server.stop();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

