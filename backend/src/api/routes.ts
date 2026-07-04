import { Hono } from 'hono';
import { getCookie } from 'hono/cookie';
import { z } from 'zod';
import { listAllProducts } from '@/lib/db/products.node';
import { getUserById } from '@/lib/db/users.node';
import {
  completeTotpSetup,
  createUserWithAuth,
  requestMfaResetEmail,
  requestSignInEmail,
  rotateRefreshToken,
  startTotpSetup,
  validateMagicLink,
  verifyTotpAndIssueSession,
} from './auth';
import { getUserId } from './security';
import { REFRESH_COOKIE, setSessionCookies, setSessionTokenHeaders } from './middleware';
import { joinNewsletter } from './newsletter';
import { appendUserEvents, postUserEventsBodySchema } from './user-events';
import { parseJson, parseQuery, strictObject } from './validation';
import { createPaymentCheckout, handlePolarWebhook, listUserEntitlements, POLAR_WEBHOOK_PATH } from './payments';
import { requestWaitlistVerification, verifyWaitlistEmail } from './waitlist';
import { unsubscribeFromUpdates } from './updates';
import { hashUserEmail } from './users';
import { clientEventSlugSchema, trackPlatformEvent } from '@/platform/events';
import { listNodes } from './nodes';

const jsonObject = z.record(z.string(), z.unknown()).default({});
const challengeHash = z.string().regex(/^[a-f0-9]{64}$/);
const tokenHashBodyBase = strictObject({ token_hash: challengeHash });
const challengeTokenHashBodyBase = strictObject({
  challenge_token_hash: challengeHash,
});
const emailBody = strictObject({ email: z.string().email() });

export function registerRoutes(app: Hono) {
  app.post('/auth/signup', async (c) => {
    const body = await parseJson(c, strictObject({ email: z.string().email(), name: z.string().optional(), profile_url: z.string().url().optional() }));
    return c.json(await createUserWithAuth(body), 201);
  });

  app.post('/auth/login', async (c) => {
    const body = await parseJson(c, emailBody);
    const result = await requestSignInEmail(body.email);
    if (!result.allowed) {
      return c.json({ error: 'email is not whitelisted; join the waitlist', action: 'join_waitlist' }, 403);
    }
    return c.json({
      ok: true,
      email_sent: true,
      expires_at: result.expiresAt.toISOString(),
    });
  });

  app.post('/auth/totp/reset/request', async (c) => {
    const body = await parseJson(c, emailBody);
    const result = await requestMfaResetEmail(body.email);
    return c.json({
      ok: result.ok,
      email_sent: true,
      expires_at: result.expiresAt.toISOString(),
    });
  });

  app.post('/auth/magic/validate', async (c) => {
    const body = await parseJson(c, tokenHashBodyBase);
    const result = await validateMagicLink(body.token_hash);
    if (!result) return c.json({ error: 'invalid or expired sign-in link' }, 401);
    return c.json({
      status: result.status,
      totp_challenge_token_hash: result.totpChallengeToken,
      expires_at: result.expiresAt.toISOString(),
    });
  });

  app.post('/auth/refresh', async (c) => {
    const rawBody = await c.req.json().catch(() => ({}));
    const body = strictObject({ refresh_token: z.string().optional() }).parse(rawBody);
    const cookieRefreshToken = getCookie(c, REFRESH_COOKIE);
    const refreshToken = cookieRefreshToken ?? c.req.header('x-refresh-token') ?? body.refresh_token;
    if (!refreshToken) return c.json({ error: 'refresh token required' }, 401);

    const result = await rotateRefreshToken(refreshToken);
    if (!result) return c.json({ error: 'invalid refresh token' }, 401);
    setSessionTokenHeaders(c, result);
    if (cookieRefreshToken) setSessionCookies(c, result);
    return c.json(result);
  });

  app.post('/auth/totp/setup/start', async (c) => {
    const body = await parseJson(c, challengeTokenHashBodyBase);
    const result = await startTotpSetup(body.challenge_token_hash);
    if (!result) return c.json({ error: 'invalid challenge or TOTP is already enabled' }, 401);
    return c.json({
      setup_challenge_token_hash: result.setupChallengeToken,
      secret: result.secret,
      otpauth_url: result.otpauthUrl,
      qr_code_data_url: result.qrCodeDataUrl,
    });
  });

  app.post('/auth/totp/setup/complete', async (c) => {
    const body = await parseJson(c, challengeTokenHashBodyBase.extend({
      codes: z.tuple([z.string().regex(/^\d{6}$/), z.string().regex(/^\d{6}$/)]),
    }));
    const result = await completeTotpSetup(body.challenge_token_hash, body.codes);
    if (!result.ok) return c.json({ error: result.error }, 400);
    setSessionTokenHeaders(c, result);
    setSessionCookies(c, result);
    return c.json({
      ok: true,
      authenticated: true,
      userId: result.userId,
      accessToken: result.accessToken,
      refreshToken: result.refreshToken,
    });
  });

  app.post('/auth/totp/verify', async (c) => {
    const body = await parseJson(c, challengeTokenHashBodyBase.extend({
      code: z.string().regex(/^\d{6}$/),
    }));
    const result = await verifyTotpAndIssueSession(body.challenge_token_hash, body.code);
    if (!result) return c.json({ error: 'invalid TOTP challenge or code' }, 401);
    setSessionTokenHeaders(c, result);
    setSessionCookies(c, result);
    return c.json(result);
  });

  app.post('/waitlist', async (c) => {
    const body = await parseJson(c, emailBody);
    return c.json(await requestWaitlistVerification(body.email), 201);
  });

  app.post('/platform/events', async (c) => {
    const body = await parseJson(c, strictObject({
      distinctId: z.string().min(1).max(200),
      slug: clientEventSlugSchema,
      metadata: jsonObject.optional(),
    }));
    trackPlatformEvent({ slug: body.slug, data: { ...body.metadata, distinct_id: body.distinctId } });
    return c.json({ ok: true }, 202);
  });

  app.post('/waitlist/verify', async (c) => {
    const body = await parseJson(c, tokenHashBodyBase);
    const result = await verifyWaitlistEmail(body.token_hash);
    if (!result) return c.json({ error: 'invalid or expired verification link' }, 401);
    return c.json({ ok: true, email: result.email, is_verified: result.isVerified });
  });

  app.get('/waitlist/verify', async (c) => {
    const query = parseQuery(c, strictObject({ token_hash: challengeHash }));
    const result = await verifyWaitlistEmail(query.token_hash);
    if (!result) return c.json({ error: 'invalid or expired verification link' }, 401);
    return c.json({ ok: true, email: result.email, is_verified: result.isVerified });
  });

  app.post('/newsletter', async (c) => {
    const body = await parseJson(c, emailBody);
    const result = await joinNewsletter(body.email);
    return c.json(result.subscription, 201);
  });

  app.post('/updates/unsubscribe', async (c) => {
    const body = await parseJson(c, tokenHashBodyBase);
    const result = await unsubscribeFromUpdates(body.token_hash);
    if (!result.ok) return c.json({ error: result.error }, 401);
    return c.json(result);
  });

  app.get('/updates/unsubscribe', async (c) => {
    const query = parseQuery(c, strictObject({ token_hash: challengeHash }));
    const result = await unsubscribeFromUpdates(query.token_hash);
    if (!result.ok) return c.json({ error: result.error }, 401);
    return c.json(result);
  });

  app.post('/users/events', async (c) => {
    const body = await parseJson(c, postUserEventsBodySchema);
    const userId = await getUserId(c);
    let emailHash = body.email_hash;

    if (userId) {
      const user = await getUserById(userId);
      if (!user) return c.json({ error: 'authenticated user not found' }, 401);
      emailHash = await hashUserEmail(user.email);
    }

    if (!emailHash) {
      return c.json({ error: 'email_hash is required when no valid access token is provided' }, 400);
    }

    const result = await appendUserEvents({ emailHash, events: body.events });
    if (!result) return c.json({ error: 'user not found' }, 404);

    return c.json({
      ok: true,
      user_id: result.id,
      inserted_count: body.events.length,
      event_count: result.insertedCount,
    }, 201);
  });

  app.get('/nodes', listNodes);

  app.get('/products', async (c) => {
    const rows = await listAllProducts();
    return c.json(rows.map((product) => ({
      id: product.key,
      product_id: product.productId,
      name: product.name,
      type: product.type,
      price_cents: product.priceCents,
      billing_period: product.billingPeriod,
      grace_period: product.gracePeriod,
      created_at: product.createdAt,
      updated_at: product.updatedAt,
    })));
  });

  app.post('/payments/checkout', createPaymentCheckout);
  app.get('/payments/entitlements', listUserEntitlements);
  app.post(POLAR_WEBHOOK_PATH, handlePolarWebhook);
  app.post(`${POLAR_WEBHOOK_PATH}/`, handlePolarWebhook);
}
