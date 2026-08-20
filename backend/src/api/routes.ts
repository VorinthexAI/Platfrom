import { Hono, type Context } from 'hono';
import { z } from 'zod';
import { countryCodeSchema } from '@/lib/db/users.node';
import {
  completeTotpSetup,
  buildOAuthAuthorizationUrl,
  completeOAuthSignIn,
  buildMobileOAuthAuthorizationUrl,
  completeNativeAppleSignIn,
  completeNativeGoogleSignIn,
  createMobileOAuthGrant,
  createUserWithAuth,
  requestFoundersGate,
  requestMfaResetEmail,
  requestSignInEmail,
  exchangeMobileOAuthGrant,
  mobileOAuthCallbackUri,
  startTotpSetup,
  validateMagicLink,
  verifyTotpAndIssueSession,
} from './auth';
import { claimHandoff, getHandoffStatus, streamHandoff } from './auth-handoff';
import { camelSessionTokenPayload, sessionTokenPayload, setSessionForRequest } from './middleware';
import { joinNewsletter } from './newsletter';
import { parseJson, parseQuery, strictObject } from './validation';
import {
  getFoundersAccount,
  listFoundersOrganizationProviders,
  listFoundersOrganizationScopes,
  listFoundersOrganizations,
  upsertFoundersOrganizationProvider,
} from './founders';
import { joinPresence, leavePresence, presenceBeat, streamPresence } from './presence';
import { unsubscribeFromUpdates } from './updates';
import { listNodes } from './nodes';
import {
  createSystemOrchestrator,
  listSystemOrchestrators,
  updateSystemOrchestrator,
} from './system';
import { invokeContentTool } from './content-tools';
import { communicationHandlers } from './communication';
import { bootstrapGuestAuth, getAuthAccount, logoutAuthAccount, patchAuthAccount } from './auth-account';
import { recordPlatformEvent } from './platform-events';
import { acceptGalleryCollectionInvite, activateGalleryCollectionShare, completeGalleryUploads, createGalleryCollection, createGalleryCollectionInvite, createGalleryCollectionShare, createGalleryHighlight, createGalleryMemory, createGallerySubject, deleteGalleryCollection, deleteGalleryCollectionDuplicates, deleteGalleryHighlight, deleteGalleryImages, deleteGalleryMemory, deleteGallerySubject, findGalleryCollectionDuplicates, galleryOverview, galleryUploadStatus, leaveGalleryCollection, listGalleryCollectionMembers, listGalleryCollectionShares, listGalleryHighlights, listGalleryMemories, listGalleryPendingInvites, listGallerySubjectImages, listGallerySubjects, presignGalleryUploads, readGalleryHighlight, readGalleryMemory, rejectGalleryCollectionInvite, removeGalleryCollectionMember, revokeGalleryCollectionInvite, revokeGalleryCollectionShare, searchGalleryImages, setGalleryImageFavorite, transferGalleryCollectionImages, updateGalleryCollection, updateGalleryCollectionMemberRole, updateGalleryCollectionShare, updateGalleryImage } from './gallery';
import { travelHandlers } from './travel';
import { countryHandlers } from './countries';
import { emailHandlers } from './email-inbox';
import { bookHandlers } from './books';
import { userHiddenHandlers } from './user-hiddens';
import { streamEvents } from './events';

const challengeHash = z.string().regex(/^[a-f0-9]{64}$/);
const tokenHashBodyBase = strictObject({ token_hash: challengeHash });
const challengeTokenHashBodyBase = strictObject({
  challenge_token_hash: challengeHash,
});
const emailSchema = z.string().trim().toLowerCase().email().max(254);
const emailBody = strictObject({ email: emailSchema });
const oauthProviderSchema = z.enum(['google', 'apple']);

export function registerRoutes(app: Hono) {
  app.post('/auth/signup', async (c) => {
    const body = await parseJson(c, strictObject({ email: emailSchema, name: z.string().optional(), profile_url: z.string().url().optional(), country_code: countryCodeSchema.optional() }));
    return c.json(await createUserWithAuth(body), 201);
  });

  app.post('/auth/login', async (c) => {
    const body = await parseJson(c, emailBody.extend({ country_code: countryCodeSchema.optional() }));
    const result = await requestSignInEmail(body.email, body.country_code);
    if (!result.allowed) {
      if ('foundersGateRequired' in result) {
        return c.json({ error: 'founders gate required', action: 'founders_gate', founders_gate_required: true }, 403);
      }
      return c.json({ error: 'sign in is unavailable for this account' }, 403);
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
    return c.json({
      ok: true,
      accepted: result.accepted,
      expires_at: result.expiresAt.toISOString(),
    }, 202);
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
    setSessionForRequest(c, result);
    return c.json({
      ok: true,
      status: result.status,
      identity: result.identity,
      ...sessionTokenPayload(c, result),
      alias: result.alias,
      alias_slug: result.aliasSlug,
      welcome_line: result.welcomeLine,
    });
  });

  app.get('/auth/mobile/oauth/:provider', async (c) => {
    const provider = oauthProviderSchema.parse(c.req.param('provider'));
    const query = parseQuery(c, strictObject({ redirect_uri: z.string().url() }));
    try {
      return c.json({ authorization_url: await buildMobileOAuthAuthorizationUrl(provider, query.redirect_uri) });
    } catch {
      return c.json({ error: 'mobile oauth is not configured' }, 503);
    }
  });

  app.post('/auth/mobile/google', async (c) => {
    const body = await parseJson(c, strictObject({ id_token: z.string().min(100).max(16_384) }));
    const result = await completeNativeGoogleSignIn(body.id_token);
    if (!result) return c.json({ error: 'google sign in failed' }, 401);
    if (result.status === 'founders_gate_required') {
      return c.json({ error: 'founders gate required', action: 'founders_gate', founders_gate_required: true }, 403);
    }
    if (result.status === 'mfa_required') {
      return c.json({ error: 'mfa required', action: 'mfa', mfa_required: true }, 403);
    }
    setSessionForRequest(c, result);
    return c.json({
      ok: true,
      status: result.status,
      identity: result.identity,
      ...sessionTokenPayload(c, result),
      alias: result.alias,
      alias_slug: result.aliasSlug,
      welcome_line: result.welcomeLine,
    });
  });

  app.post('/auth/mobile/apple', async (c) => {
    const body = await parseJson(c, strictObject({
      id_token: z.string().min(100).max(16_384),
      nonce: z.string().uuid(),
      name: z.string().trim().min(1).max(200).optional(),
    }));
    const result = await completeNativeAppleSignIn(body.id_token, body.nonce, body.name);
    if (!result) return c.json({ error: 'apple sign in failed' }, 401);
    if (result.status === 'founders_gate_required') {
      return c.json({ error: 'founders gate required', action: 'founders_gate', founders_gate_required: true }, 403);
    }
    if (result.status === 'mfa_required') {
      return c.json({ error: 'mfa required', action: 'mfa', mfa_required: true }, 403);
    }
    setSessionForRequest(c, result);
    return c.json({
      ok: true,
      status: result.status,
      identity: result.identity,
      ...sessionTokenPayload(c, result),
      alias: result.alias,
      alias_slug: result.aliasSlug,
      welcome_line: result.welcomeLine,
    });
  });

  const mobileOAuthCallback = async (c: Context) => {
    const provider = oauthProviderSchema.parse(c.req.param('provider'));
    const rawState = new URL(c.req.url).searchParams.get('state');
    if (provider === 'google' && rawState?.startsWith('vrtx_email_state_')) return emailHandlers.callback(c);
    const callbackSchema = strictObject({
      code: z.string().min(1),
      state: z.string().min(1),
      user: z.string().max(16_384).optional(),
    });
    const callback = c.req.method === 'POST'
      ? callbackSchema.parse(await c.req.parseBody())
      : parseQuery(c, callbackSchema);
    const result = await completeOAuthSignIn({
      provider,
      code: callback.code,
      state: callback.state,
      redirectUri: mobileOAuthCallbackUri(provider),
    });
    if (!result) return c.json({ error: 'oauth sign in failed' }, 401);
    if (!result.mobileRedirectUri) return c.json({ error: 'invalid mobile oauth state' }, 401);
    const redirect = new URL(result.mobileRedirectUri);
    if (result.status !== 'authenticated') {
      redirect.searchParams.set('error', result.status === 'founders_gate_required' ? 'founders_gate_required' : 'mfa_required');
      return c.redirect(redirect.toString(), 302);
    }
    const code = await createMobileOAuthGrant({
      accessToken: result.accessToken,
      refreshToken: result.refreshToken,
      accessTokenMaxAgeSeconds: result.accessTokenMaxAgeSeconds,
      refreshTokenMaxAgeSeconds: result.refreshTokenMaxAgeSeconds,
      sessionExpiresAt: result.sessionExpiresAt,
      alias: result.alias,
      aliasSlug: result.aliasSlug,
      welcomeLine: result.welcomeLine,
    });
    redirect.searchParams.set('code', code);
    return c.redirect(redirect.toString(), 302);
  };
  app.get('/auth/mobile/oauth/:provider/callback', mobileOAuthCallback);
  app.post('/auth/mobile/oauth/:provider/callback', mobileOAuthCallback);

  app.post('/auth/mobile/oauth/exchange', async (c) => {
    const body = await parseJson(c, strictObject({ code: z.string().startsWith('vrtx_mobile_grant_').max(256) }));
    const result = await exchangeMobileOAuthGrant(body.code);
    if (!result) return c.json({ error: 'invalid or expired mobile oauth grant' }, 401);
    setSessionForRequest(c, result);
    return c.json({
      ...sessionTokenPayload(c, result),
      alias: result.alias,
      alias_slug: result.aliasSlug,
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
      setSessionForRequest(c, result);
    }
    return c.json({
      status: result.status,
      ...(result.status === 'authenticated'
        ? {
          ...sessionTokenPayload(c, result),
          alias: result.alias,
          alias_slug: result.aliasSlug,
          welcome_line: result.welcomeLine,
        }
        : {
          totp_challenge_token_hash: result.totpChallengeToken,
          expires_at: result.expiresAt.toISOString(),
        }),
    });
  });

  app.post('/auth/totp/reset/request', async (c) => {
    const body = await parseJson(c, challengeTokenHashBodyBase);
    const result = await requestMfaResetEmail(body.challenge_token_hash);
    if (!result) return c.json({ error: 'invalid or expired founder MFA challenge' }, 401);
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
    if (result.status === 'authenticated') {
      setSessionForRequest(c, result);
      return c.json({
        status: result.status,
        identity: result.identity,
        ...sessionTokenPayload(c, result),
        alias: result.alias,
        alias_slug: result.aliasSlug,
        welcome_line: result.welcomeLine,
      });
    }
    if (result.status === 'totp_setup') {
      return c.json({
        status: result.status,
        setup_challenge_token_hash: result.setupChallengeToken,
        expires_at: result.expiresAt.toISOString(),
        secret: result.secret,
        otpauth_url: result.otpauthUrl,
        qr_code_data_url: result.qrCodeDataUrl,
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
      expires_at: result.expiresAt.toISOString(),
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
    setSessionForRequest(c, result);
    return c.json({
      ok: true,
      authenticated: true,
      identity: result.identity,
      name: result.name,
      organization_title: result.organizationTitle,
      ...camelSessionTokenPayload(c, result),
    });
  });

  app.post('/auth/totp/verify', async (c) => {
    const body = await parseJson(c, challengeTokenHashBodyBase.extend({
      code: z.string().regex(/^\d{6}$/),
    }));
    const result = await verifyTotpAndIssueSession(body.challenge_token_hash, body.code);
    if (!result) return c.json({ error: 'invalid TOTP challenge or code' }, 401);
    setSessionForRequest(c, result);
    return c.json({
      identity: result.identity,
      name: result.name,
      organizationTitle: result.organizationTitle,
      ...camelSessionTokenPayload(c, result),
    });
  });

  app.post('/auth/guest', bootstrapGuestAuth);
  app.get('/auth/me', getAuthAccount);
  app.patch('/auth/me', patchAuthAccount);
  app.get('/auth/me/hiddens', userHiddenHandlers.list);
  app.post('/auth/me/hiddens', userHiddenHandlers.hide);
  app.delete('/auth/me/hiddens', userHiddenHandlers.reveal);
  app.post('/auth/logout', logoutAuthAccount);

  app.post('/app/events', recordPlatformEvent);
  app.get('/events/stream', streamEvents);

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

  app.get('/nodes', listNodes);

  app.post('/content/tools/:tool', invokeContentTool);
  app.post('/gallery/overview', galleryOverview);
  app.post('/gallery/collections', createGalleryCollection);
  app.post('/gallery/collections/update', updateGalleryCollection);
  app.post('/gallery/collections/delete', deleteGalleryCollection);
  app.post('/gallery/collections/members', listGalleryCollectionMembers);
  app.post('/gallery/collections/members/role', updateGalleryCollectionMemberRole);
  app.post('/gallery/collections/members/remove', removeGalleryCollectionMember);
  app.post('/gallery/collections/leave', leaveGalleryCollection);
  app.post('/gallery/invites/pending', listGalleryPendingInvites);
  app.post('/gallery/invites', createGalleryCollectionInvite);
  app.post('/gallery/invites/accept', acceptGalleryCollectionInvite);
  app.post('/gallery/invites/reject', rejectGalleryCollectionInvite);
  app.post('/gallery/invites/revoke', revokeGalleryCollectionInvite);
  app.post('/gallery/collections/shares/list', listGalleryCollectionShares);
  app.post('/gallery/collections/shares', createGalleryCollectionShare);
  app.post('/gallery/collections/shares/update', updateGalleryCollectionShare);
  app.post('/gallery/collections/shares/revoke', revokeGalleryCollectionShare);
  app.post('/gallery/shares/activate', activateGalleryCollectionShare);
  app.post('/gallery/uploads/presign', presignGalleryUploads);
  app.post('/gallery/uploads/complete', completeGalleryUploads);
  app.post('/gallery/uploads/status', galleryUploadStatus);
  app.post('/gallery/images/search', searchGalleryImages);
  app.post('/gallery/images/favorite', setGalleryImageFavorite);
  app.post('/gallery/images/update', updateGalleryImage);
  app.post('/gallery/images/delete', deleteGalleryImages);
  app.post('/gallery/collections/duplicates', findGalleryCollectionDuplicates);
  app.post('/gallery/collections/duplicates/delete', deleteGalleryCollectionDuplicates);
  app.post('/gallery/collections/images/transfer', transferGalleryCollectionImages);
  app.post('/gallery/subjects/list', listGallerySubjects);
  app.post('/gallery/subjects', createGallerySubject);
  app.post('/gallery/subjects/images', listGallerySubjectImages);
  app.post('/gallery/subjects/delete', deleteGallerySubject);
  app.post('/gallery/highlights', createGalleryHighlight);
  app.get('/gallery/highlights', listGalleryHighlights);
  app.post('/gallery/highlights/read', readGalleryHighlight);
  app.post('/gallery/highlights/delete', deleteGalleryHighlight);
  app.post('/gallery/memories', createGalleryMemory);
  app.get('/gallery/memories', listGalleryMemories);
  app.post('/gallery/memories/read', readGalleryMemory);
  app.post('/gallery/memories/delete', deleteGalleryMemory);
  app.post('/travel/overview', travelHandlers.overview);
  app.post('/travel/countries/search', countryHandlers.search);
  app.post('/travel/places', travelHandlers.createPlace);
  app.post('/travel/places/find', travelHandlers.findPlace);
  app.post('/travel/cities/find', travelHandlers.findCity);
  app.post('/travel/places/image', travelHandlers.generatePlaceHeroImage);
  app.post('/email/overview', emailHandlers.overview);
  app.post('/email/connect', emailHandlers.startConnect);
  app.get('/email/connectors/gmail/callback', emailHandlers.callback);
  app.post('/email/connect/exchange', emailHandlers.exchangeConnect);
  app.post('/email/sync', emailHandlers.sync);
  app.post('/email/threads/:threadKey', emailHandlers.thread);
  app.post('/email/threads/:threadKey/favorite', emailHandlers.favorite);
  app.post('/email/drafts', emailHandlers.draft);
  app.patch('/email/drafts/:draftKey', emailHandlers.updateDraft);
  app.post('/email/drafts/:draftKey/send', emailHandlers.sendDraft);
  app.post('/email/disconnect', emailHandlers.disconnect);
  app.post('/books/overview', bookHandlers.overview);
  app.post('/books', bookHandlers.create);
  app.post('/books/:bookKey/detail', bookHandlers.detail);
  app.patch('/books/:bookKey/chapters/:chapterKey/progress', bookHandlers.progress);

  app.get('/founders/me', getFoundersAccount);
  app.get('/founders/organizations', listFoundersOrganizations);
  app.get('/founders/organizations/:organizationKey/scopes', listFoundersOrganizationScopes);
  app.get('/founders/organizations/:organizationKey/providers', listFoundersOrganizationProviders);
  app.put('/founders/organizations/:organizationKey/providers/:provider', upsertFoundersOrganizationProvider);
  app.get('/founders/organizations/:organizationKey/communication/channels', communicationHandlers.listChannels);
  app.get('/founders/organizations/:organizationKey/communication/channels/:channelKey/messages', communicationHandlers.listMessages);
  app.get('/founders/organizations/:organizationKey/communication/channels/:channelKey/typing', communicationHandlers.typingStream);
  app.post('/founders/organizations/:organizationKey/communication/channels/:channelKey/typing', communicationHandlers.typing);
  app.delete('/founders/organizations/:organizationKey/communication/channels/:channelKey/messages/:messageKey', communicationHandlers.deleteMessage);
  app.patch('/founders/organizations/:organizationKey/communication/channels/:channelKey/messages/:messageKey', communicationHandlers.editMessage);
  app.post('/founders/organizations/:organizationKey/communication/channels/:channelKey/messages', communicationHandlers.postMessage);
  app.post('/founders/organizations/:organizationKey/communication/channels/:channelKey/messages/:messageKey/reactions', communicationHandlers.react);
  app.get('/founders/organizations/:organizationKey/communication/channels/:channelKey/messages/:messageKey/replies', communicationHandlers.readReplies);
  app.get('/founders/organizations/:organizationKey/communication/reactions', communicationHandlers.frequentReactions);
  app.post('/founders/organizations/:organizationKey/communication/channels/:channelKey/polls', communicationHandlers.createPoll);
  app.get('/founders/organizations/:organizationKey/communication/channels/:channelKey/polls/:pollKey', communicationHandlers.readPoll);
  app.post('/founders/organizations/:organizationKey/communication/channels/:channelKey/polls/:pollKey/votes', communicationHandlers.votePoll);
  app.post('/founders/organizations/:organizationKey/communication/channels/:channelKey/polls/:pollKey/close', communicationHandlers.closePoll);

  app.get('/system/orchestrators', listSystemOrchestrators);
  app.post('/system/orchestrators', createSystemOrchestrator);
  app.patch('/system/orchestrators/:orchestratorId', updateSystemOrchestrator);

}
