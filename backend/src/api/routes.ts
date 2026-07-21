import { Hono } from 'hono';
import { z } from 'zod';
import { listAllProducts } from '@/lib/db/products.node';
import { getUserById } from '@/lib/db/users.node';
import {
  completeTotpSetup,
  buildOAuthAuthorizationUrl,
  completeOAuthSignIn,
  createUserWithAuth,
  requestFoundersGate,
  requestMfaResetEmail,
  requestSignInEmail,
  resetTotpForChallenge,
  startTotpSetup,
  validateMagicLink,
  verifyTotpAndIssueSession,
} from './auth';
import { claimHandoff, getHandoffStatus, streamHandoff } from './auth-handoff';
import { getUserId } from './security';
import { setSessionCookies, setSessionTokenHeaders } from './middleware';
import { joinNewsletter } from './newsletter';
import { appendUserEvents, postUserEventsBodySchema } from './user-events';
import { parseJson, parseQuery, strictObject } from './validation';
import { createPaymentCheckout, handlePolarWebhook, listUserEntitlements, POLAR_WEBHOOK_PATH } from './payments';
import { requestWaitlistVerification, verifyWaitlistEmail } from './waitlist';
import { recordPlatformClientEvent } from './platform-events';
import {
  getFoundersAccount,
  listFoundersOrganizationProviders,
  listFoundersOrganizationScopes,
  listFoundersOrganizations,
  upsertFoundersOrganizationProvider,
} from './founders';
import {
  createFounderArtifact,
  deleteFounderArtifact,
  getFounderArtifact,
  listFounderArtifacts,
  resolveFounderArtifact,
  readFounderArtifactNode,
  updateFounderArtifact,
} from './founder-artifacts';
import { streamNexusOrganizationInvalidations } from './nexus-events';
import { collectFragment, getFragmentsStanding, getFragmentsSummary } from './fragments';
import { streamLeaderboard } from './leaderboard';
import { streamLiveCounters } from './live';
import { joinPresence, leavePresence, presenceBeat, streamPresence } from './presence';
import { unsubscribeFromUpdates } from './updates';
import { hashUserEmail } from './users';
import { listNodes } from './nodes';
import { postOrchestratorChat } from './orchestrators';
import {
  attachCurrentMindCapability,
  createSystemCapability,
  createSystemOrchestrator,
  detachCurrentMindCapability,
  getCurrentMind,
  listCurrentMindCapabilities,
  listSystemCapabilities,
  listSystemOrchestrators,
  updateSystemCapability,
  updateSystemOrchestrator,
  upsertCurrentMind,
} from './system';

const challengeHash = z.string().regex(/^[a-f0-9]{64}$/);
const tempEmailHash = z.string().regex(/^[a-f0-9]{64}$/);
const explorerIdSchema = z.string().min(8).max(80).optional();
const tokenHashBodyBase = strictObject({ token_hash: challengeHash });
const challengeTokenHashBodyBase = strictObject({
  challenge_token_hash: challengeHash,
});
const emailSchema = z.string().trim().toLowerCase().email().max(254);
const emailBody = strictObject({ email: emailSchema });
const oauthProviderSchema = z.enum(['google', 'apple']);

export function registerRoutes(app: Hono) {
  app.post('/auth/signup', async (c) => {
    const body = await parseJson(c, strictObject({ email: emailSchema, name: z.string().optional(), profile_url: z.string().url().optional() }));
    return c.json(await createUserWithAuth(body), 201);
  });

  app.post('/auth/login', async (c) => {
    const body = await parseJson(c, emailBody);
    const result = await requestSignInEmail(body.email);
    if (!result.allowed) {
      if ('foundersGateRequired' in result) {
        return c.json({ error: 'founders gate required', action: 'founders_gate', founders_gate_required: true }, 403);
      }
      return c.json({ error: 'email is not whitelisted; join the waitlist', action: 'join_waitlist' }, 403);
    }
    return c.json({
      ok: true,
      email_sent: !('organizationMfaRequired' in result),
      expires_at: result.expiresAt.toISOString(),
      ...('organizationMfaRequired' in result
        ? {
          organization_mfa_required: true,
          status: result.status,
          totp_challenge_token_hash: result.totpChallengeToken,
          name: result.name,
          organization_title: result.organizationTitle,
        }
        : {}),
      ...('handoffTokenHash' in result && result.handoffTokenHash
        ? {
          handoff_token_hash: result.handoffTokenHash,
          handoff_expires_at: result.handoffExpiresAt.toISOString(),
        }
        : {}),
    });
  });

  app.post('/auth/founders-gate', async (c) => {
    const body = await parseJson(c, emailBody);
    const result = await requestFoundersGate(body.email);
    if (!result.allowed) {
      return c.json({ error: 'founder identity not found' }, 403);
    }
    return c.json({
      ok: true,
      status: result.status,
      totp_challenge_token_hash: result.totpChallengeToken,
      expires_at: result.expiresAt.toISOString(),
      name: result.name,
      organization_title: result.organizationTitle,
      orchestrator_slug: result.orchestratorSlug,
    });
  });

  app.get('/auth/oauth/start', async (c) => {
    const query = parseQuery(c, strictObject({
      provider: oauthProviderSchema,
      redirect_uri: z.string().url(),
    }));
    try {
      return c.json({
        authorization_url: await buildOAuthAuthorizationUrl(query.provider, query.redirect_uri),
      });
    } catch {
      return c.json({ error: 'oauth provider is not configured' }, 503);
    }
  });

  app.post('/auth/oauth/callback', async (c) => {
    const body = await parseJson(c, strictObject({
      provider: oauthProviderSchema,
      code: z.string().min(1),
      state: z.string().min(1),
      redirect_uri: z.string().url(),
    }));
    const result = await completeOAuthSignIn({
      provider: body.provider,
      code: body.code,
      state: body.state,
      redirectUri: body.redirect_uri,
    });
    if (!result) return c.json({ error: 'oauth sign in failed' }, 401);
    if (result.status === 'founders_gate_required') {
      return c.json({ error: 'founders gate required', action: 'founders_gate', founders_gate_required: true }, 403);
    }
    if (result.status === 'mfa_required') {
      // The organization enforces MFA — OAuth can't skip the TOTP flow;
      // the client sends the member through the email sign-in path.
      return c.json({ error: 'mfa required', action: 'mfa', mfa_required: true }, 403);
    }
    setSessionTokenHeaders(c, result);
    setSessionCookies(c, result);
    return c.json({
      ok: true,
      status: result.status,
      identity: result.identity,
      access_token: result.accessToken,
      refresh_token: result.refreshToken,
      access_token_max_age_seconds: result.accessTokenMaxAgeSeconds,
      refresh_token_max_age_seconds: result.refreshTokenMaxAgeSeconds,
      session_expires_at: result.sessionExpiresAt,
      alias: result.alias,
      alias_slug: result.aliasSlug,
      waitlist_number: result.waitlistNumber,
      welcome_line: result.welcomeLine,
    });
  });

  // Cross-device handoff: the browser that requested a link waits here,
  // then trades its approved secret for a session of its own.
  app.get('/auth/handoff/stream', streamHandoff);

  app.get('/auth/handoff/status', async (c) => {
    const query = parseQuery(c, strictObject({ handoff: challengeHash }));
    return c.json({ status: await getHandoffStatus(query.handoff) });
  });

  app.post('/auth/handoff/claim', async (c) => {
    const body = await parseJson(c, strictObject({ handoff_token_hash: challengeHash }));
    const result = await claimHandoff(body.handoff_token_hash);
    if (!result) return c.json({ error: 'handoff is not claimable' }, 401);
    if (result.status === 'authenticated') {
      setSessionTokenHeaders(c, result);
      setSessionCookies(c, result);
    }
    return c.json({
      status: result.status,
      ...(result.status === 'authenticated'
        ? {
          access_token: result.accessToken,
          refresh_token: result.refreshToken,
          access_token_max_age_seconds: result.accessTokenMaxAgeSeconds,
          refresh_token_max_age_seconds: result.refreshTokenMaxAgeSeconds,
          session_expires_at: result.sessionExpiresAt,
          alias: result.alias,
          alias_slug: result.aliasSlug,
          waitlist_number: result.waitlistNumber,
          welcome_line: result.welcomeLine,
        }
        : {
          totp_challenge_token_hash: result.totpChallengeToken,
          expires_at: result.expiresAt.toISOString(),
        }),
    });
  });

  app.post('/auth/totp/reset/request', async (c) => {
    const body = await parseJson(c, strictObject({
      email: emailSchema.optional(),
      challenge_token_hash: challengeHash.optional(),
    }));
    if (body.challenge_token_hash) {
      const result = await resetTotpForChallenge(body.challenge_token_hash);
      if (!result) return c.json({ error: 'invalid TOTP challenge' }, 401);
      return c.json({
        ok: true,
        reset: true,
        setup_challenge_token_hash: result.setupChallengeToken,
        secret: result.secret,
        otpauth_url: result.otpauthUrl,
        qr_code_data_url: result.qrCodeDataUrl,
      });
    }
    if (!body.email) return c.json({ error: 'email or challenge token required' }, 400);
    const result = await requestMfaResetEmail(body.email);
    return c.json({
      ok: result.ok,
      email_sent: result.emailSent,
      expires_at: result.expiresAt.toISOString(),
    });
  });

  app.post('/auth/magic/validate', async (c) => {
    const body = await parseJson(c, tokenHashBodyBase.extend({ explorer_id: explorerIdSchema }));
    const result = await validateMagicLink(body.token_hash, body.explorer_id);
    if (!result) return c.json({ error: 'invalid or expired sign-in link' }, 401);
    if (result.status === 'authenticated') {
      setSessionTokenHeaders(c, result);
      setSessionCookies(c, result);
      return c.json({
        status: result.status,
        identity: result.identity,
        access_token: result.accessToken,
        refresh_token: result.refreshToken,
        access_token_max_age_seconds: result.accessTokenMaxAgeSeconds,
        refresh_token_max_age_seconds: result.refreshTokenMaxAgeSeconds,
        session_expires_at: result.sessionExpiresAt,
        alias: result.alias,
        alias_slug: result.aliasSlug,
        waitlist_number: result.waitlistNumber,
        welcome_line: result.welcomeLine,
      });
    }
    return c.json({
      status: result.status,
      totp_challenge_token_hash: result.totpChallengeToken,
      expires_at: result.expiresAt.toISOString(),
    });
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
      identity: result.identity,
      name: result.name,
      organization_title: result.organizationTitle,
      accessToken: result.accessToken,
      refreshToken: result.refreshToken,
      accessTokenMaxAgeSeconds: result.accessTokenMaxAgeSeconds,
      refreshTokenMaxAgeSeconds: result.refreshTokenMaxAgeSeconds,
      sessionExpiresAt: result.sessionExpiresAt,
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
    const body = await parseJson(c, strictObject({
      email: emailSchema,
      explorer_id: z.string().min(8).max(80).optional(),
      distinct_id: z.string().min(8).max(80).optional(),
      temp_email_hash: tempEmailHash.optional(),
    }));
    const result = await requestWaitlistVerification(body.email, body.explorer_id, body.distinct_id, body.temp_email_hash);
    const { waitlistNumber, aliasSlug, ...rest } = result;
    return c.json({ ...rest, alias_slug: aliasSlug, waitlist_number: waitlistNumber }, 201);
  });

  app.post('/platform/events', recordPlatformClientEvent);

  app.post('/waitlist/verify', async (c) => {
    const body = await parseJson(c, tokenHashBodyBase.extend({ explorer_id: explorerIdSchema }));
    const result = await verifyWaitlistEmail(body.token_hash, body.explorer_id);
    if (!result) return c.json({ error: 'invalid or expired verification link' }, 401);
    return c.json({
      ok: true,
      email: result.email,
      is_verified: result.isVerified,
      alias: result.alias,
      alias_slug: result.aliasSlug,
      waitlist_number: result.waitlistNumber,
      welcome_line: result.welcomeLine,
    });
  });

  app.get('/waitlist/verify', async (c) => {
    const query = parseQuery(c, strictObject({ token_hash: challengeHash, explorer_id: explorerIdSchema }));
    const result = await verifyWaitlistEmail(query.token_hash, query.explorer_id);
    if (!result) return c.json({ error: 'invalid or expired verification link' }, 401);
    return c.json({
      ok: true,
      email: result.email,
      is_verified: result.isVerified,
      alias: result.alias,
      alias_slug: result.aliasSlug,
      waitlist_number: result.waitlistNumber,
      welcome_line: result.welcomeLine,
    });
  });

  app.post('/fragments', collectFragment);
  app.get('/fragments/summary', getFragmentsSummary);
  app.get('/fragments/standing', getFragmentsStanding);

  app.get('/live/stream', streamLiveCounters);
  app.get('/leaderboard/stream', streamLeaderboard);

  app.post('/presence/join', joinPresence);
  app.post('/presence/beat', presenceBeat);
  app.post('/presence/leave', leavePresence);
  app.get('/presence/stream', streamPresence);

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

    const result = await appendUserEvents({
      userId: userId ?? undefined,
      emailHash,
      events: body.events,
    });
    if (!result) return c.json({ error: 'user not found' }, 404);

    return c.json({
      ok: true,
      user_id: result.id,
      inserted_count: body.events.length,
      event_count: result.insertedCount,
    }, 201);
  });

  app.get('/nodes', listNodes);

  app.get('/mind', getCurrentMind);
  app.post('/mind', upsertCurrentMind);
  app.put('/mind', upsertCurrentMind);
  app.get('/mind/capabilities', listCurrentMindCapabilities);
  app.post('/mind/capabilities', attachCurrentMindCapability);
  app.delete('/mind/capabilities/:capabilityId', detachCurrentMindCapability);

  app.post('/orchestrators/chat', postOrchestratorChat);

  app.get('/founders/me', getFoundersAccount);
  app.get('/founders/organizations', listFoundersOrganizations);
  app.get('/founders/organizations/:organizationKey/scopes', listFoundersOrganizationScopes);
  app.get('/founders/organizations/:organizationKey/providers', listFoundersOrganizationProviders);
  app.put('/founders/organizations/:organizationKey/providers/:provider', upsertFoundersOrganizationProvider);
  app.get('/founders/artifacts', listFounderArtifacts);
  app.post('/founders/artifacts', createFounderArtifact);
  app.get('/nexus/events/stream', streamNexusOrganizationInvalidations);
  app.get('/founders/artifacts/:artifactKey', getFounderArtifact);
  app.patch('/founders/artifacts/:artifactKey', updateFounderArtifact);
  app.delete('/founders/artifacts/:artifactKey', deleteFounderArtifact);
  app.post('/founders/artifacts/:artifactKey/resolve', resolveFounderArtifact);
  app.post('/founders/artifacts/:artifactKey/nodes/read', readFounderArtifactNode);

  app.get('/system/orchestrators', listSystemOrchestrators);
  app.post('/system/orchestrators', createSystemOrchestrator);
  app.patch('/system/orchestrators/:orchestratorId', updateSystemOrchestrator);
  app.get('/system/capabilities', listSystemCapabilities);
  app.post('/system/capabilities', createSystemCapability);
  app.patch('/system/capabilities/:capabilityId', updateSystemCapability);

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
