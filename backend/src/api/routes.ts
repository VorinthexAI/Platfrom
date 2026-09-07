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
  listFoundersTeamScopes,
  listFoundersTeams,
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
import { bootstrapGuestAuth, deleteAuthAccount, getAuthAccount, logoutAuthAccount, patchAuthAccount } from './auth-account';
import { completeGalleryUploads, createGalleryCollection, createGalleryHighlight, createGalleryMemory, createGallerySubject, deleteGalleryCollection, deleteGalleryCollectionDuplicates, deleteGalleryHighlight, deleteGalleryImages, deleteGalleryMemory, deleteGallerySubject, findGalleryCollectionDuplicates, galleryOverview, galleryUploadStatus, listGalleryHighlights, listGalleryMemories, listGallerySubjectImages, listGallerySubjects, presignGalleryUploads, readGalleryHighlight, readGalleryMemory, searchGalleryImages, setGalleryImageFavorite, transferGalleryCollectionImages, updateGalleryCollection, updateGalleryImage } from './gallery';
import { travelHandlers } from './travel';
import { countryHandlers } from './countries';
import { emailHandlers } from './email-inbox';
import { bookHandlers } from './books';
import { respondToAssistant } from './assistant';
import { userHiddenHandlers } from './user-hiddens';
import { streamEvents } from './events';
import { searchApp } from './app-search';
import { appTransformationHandlers } from './app-transformation';
import { appSpeechHandler } from './app-speech';
import { deleteImageGenerationHistory, generateImage, listImageGenerationHistory } from './image-generation';
import { conversationHandlers } from './conversations';
import { transientAttachmentHandlers } from './transient-attachments';
import { completeAccountAvatar, presignAccountAvatar, updateAccountProfile } from './account-profile';
import { feedbackHandlers, ticketHandler } from './tickets';
import { listApps } from './apps';
import { tagHandlers } from './tags';
import { recordAnalyticsEvent } from './event-ingestion';
import { getBillingSummary } from './billing';
import { getReferralSummary } from './referrals';
import { referralCodeTransportSchema } from './auth-referral-code';
import { commerceHandlers } from './commerce';
import { onboardingSandboxHandlers } from './onboarding-sandbox';
import { scopeHandlers } from './scopes';
import { appNotificationHandlers } from './app-notifications';
import { teamHandlers } from './teams';
import { listCosts } from './costs';

const challengeHash = z.string().regex(/^[a-f0-9]{64}$/);
const tokenHashBodyBase = strictObject({ token_hash: challengeHash });
const challengeTokenHashBodyBase = strictObject({
  challenge_token_hash: challengeHash,
});
const emailSchema = z.string().trim().toLowerCase().email().max(254);
const emailBody = strictObject({ email: emailSchema });
const oauthProviderSchema = z.enum(['google', 'apple']);
export const authTransportSchemas = Object.freeze({
  signup: strictObject({ email: emailSchema, name: z.string().optional(), country_code: countryCodeSchema.optional() }),
  login: emailBody.extend({ country_code: countryCodeSchema.optional(), referral_code: referralCodeTransportSchema.optional() }),
  oauthStart: strictObject({ provider: oauthProviderSchema, redirect_uri: z.string().url(), referral_code: referralCodeTransportSchema.optional() }),
  mobileOAuthStart: strictObject({ redirect_uri: z.string().url(), referral_code: referralCodeTransportSchema.optional() }),
  mobileGoogle: strictObject({ id_token: z.string().min(100).max(16_384), referral_code: referralCodeTransportSchema.optional() }),
  mobileApple: strictObject({ id_token: z.string().min(100).max(16_384), nonce: z.string().uuid(), name: z.string().trim().min(1).max(200).optional(), referral_code: referralCodeTransportSchema.optional() }),
});

export function registerRoutes(app: Hono) {
  app.get('/apps', listApps);
  app.post('/onboarding/sandbox/sessions', onboardingSandboxHandlers.createSession);
  app.post('/onboarding/sandbox/answers', onboardingSandboxHandlers.answer);
  app.get('/products', commerceHandlers.listProducts);
  app.get('/costs', listCosts);
  app.post('/payments/checkouts', commerceHandlers.createCheckout);
  app.post('/payments/checkout-handoffs', commerceHandlers.issueCheckoutHandoff);
  app.post('/payments/checkout-handoffs/resolve', commerceHandlers.inspectCheckoutHandoff);
  app.post('/payments/checkout-handoffs/continue', commerceHandlers.continueCheckoutHandoff);
  app.get('/subscriptions/current', commerceHandlers.currentSubscription);
  app.post('/subscriptions/current/cancel', commerceHandlers.cancelSubscription);
  app.post('/subscriptions/current/restore', commerceHandlers.restoreSubscription);
  app.get('/billing/summary', getBillingSummary);
  app.get('/referrals/summary', getReferralSummary);
  app.post('/auth/signup', async (c) => {
    const body = await parseJson(c, authTransportSchemas.signup);
    return c.json(await createUserWithAuth(body), 201);
  });

  app.post('/auth/login', async (c) => {
    const body = await parseJson(c, authTransportSchemas.login);
    const result = await requestSignInEmail(body.email, body.country_code, body.referral_code);
    if (!result.allowed) {
      if ('foundersGateRequired' in result) {
        return c.json({ error: 'founders gate required', action: 'founders_gate', founders_gate_required: true }, 403);
      }
      return c.json({ error: 'sign in is unavailable for this account' }, 403);
    }
    return c.json({
      ok: true,
      email_sent: true,
      expires_at: result.expiresAt.toISOString(),
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
    const query = parseQuery(c, authTransportSchemas.oauthStart);
    try {
      return c.json({
        authorization_url: await buildOAuthAuthorizationUrl(query.provider, query.redirect_uri, undefined, query.referral_code),
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
    const query = parseQuery(c, authTransportSchemas.mobileOAuthStart);
    try {
      return c.json({ authorization_url: await buildMobileOAuthAuthorizationUrl(provider, query.redirect_uri, query.referral_code) });
    } catch {
      return c.json({ error: 'mobile oauth is not configured' }, 503);
    }
  });

  app.post('/auth/mobile/google', async (c) => {
    const body = await parseJson(c, authTransportSchemas.mobileGoogle);
    const result = await completeNativeGoogleSignIn(body.id_token, body.referral_code);
    if (!result) return c.json({ error: 'google sign in failed' }, 401);
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
    const body = await parseJson(c, authTransportSchemas.mobileApple);
    const result = await completeNativeAppleSignIn(body.id_token, body.nonce, body.name, body.referral_code);
    if (!result) return c.json({ error: 'apple sign in failed' }, 401);
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
    if (!result) return c.json({ error: 'invalid or expired team MFA challenge' }, 401);
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
      team_title: result.teamTitle,
      teamKey: result.teamKey,
      scopeKey: result.scopeKey,
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
      teamTitle: result.teamTitle,
      teamKey: result.teamKey,
      scopeKey: result.scopeKey,
      ...camelSessionTokenPayload(c, result),
    });
  });

  app.post('/auth/guest', bootstrapGuestAuth);
  app.get('/auth/me', getAuthAccount);
  app.patch('/auth/me', patchAuthAccount);
  app.post('/auth/me/delete', deleteAuthAccount);
  app.patch('/auth/me/profile', updateAccountProfile);
  app.post('/auth/me/profile/avatar/uploads/presign', presignAccountAvatar);
  app.post('/auth/me/profile/avatar/uploads/complete', completeAccountAvatar);
  app.get('/auth/me/hiddens', userHiddenHandlers.list);
  app.post('/auth/me/hiddens', userHiddenHandlers.hide);
  app.delete('/auth/me/hiddens', userHiddenHandlers.reveal);
  app.post('/auth/logout', logoutAuthAccount);
  app.put('/auth/me/push-subscription', appNotificationHandlers.register);
  app.delete('/auth/me/push-subscription', appNotificationHandlers.unregister);
  app.post('/auth/me/notifications', appNotificationHandlers.list);
  app.post('/tickets', ticketHandler);
  app.post('/feedback', feedbackHandlers.create);
  app.post('/feedback/list', feedbackHandlers.list);
  app.put('/feedback/:ticketKey/vote', feedbackHandlers.vote);

  app.post('/app/search', searchApp);
  app.post('/app/notify', appNotificationHandlers.notify);
  app.post('/scopes/list', scopeHandlers.list);
  app.post('/scopes', scopeHandlers.create);
  app.post('/scopes/select', scopeHandlers.select);
  app.post('/teams/list', teamHandlers.list);
  app.post('/teams/select', teamHandlers.select);
  app.post('/tags/list', tagHandlers.list);
  app.post('/tags', tagHandlers.create);
  app.patch('/tags/:tagKey', tagHandlers.update);
  app.delete('/tags/:tagKey', tagHandlers.delete);
  app.post('/tags/assignments', tagHandlers.assignments);
  app.post('/images/generate', generateImage);
  app.get('/images/generation-history', listImageGenerationHistory);
  app.delete('/images/generation-history', deleteImageGenerationHistory);
  app.post('/events', recordAnalyticsEvent);
  app.get('/events/stream', streamEvents);
  app.post('/conversations', conversationHandlers.create);
  app.post('/conversations/list', conversationHandlers.list);
  app.post('/conversations/search', conversationHandlers.search);
  app.patch('/conversations/:conversationKey', conversationHandlers.rename);
  app.post('/conversations/:conversationKey/favorite', conversationHandlers.favorite);
  app.delete('/conversations/:conversationKey', conversationHandlers.delete);
  app.post('/conversations/:conversationKey/messages/list', conversationHandlers.messages);
  app.delete('/conversations/:conversationKey/messages/:messageKey', conversationHandlers.deleteMessage);
  app.post('/conversations/:conversationKey/image-turns', conversationHandlers.imageTurn);
  app.post('/conversations/:conversationKey/turn/stream', conversationHandlers.turn);
  app.post('/conversations/:conversationKey/attachments/uploads/presign', transientAttachmentHandlers.reserve);
  app.post('/conversations/:conversationKey/attachments/uploads/complete', transientAttachmentHandlers.complete);

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
  app.post('/travel/places/update', travelHandlers.updatePlace);
  app.post('/travel/places/delete', travelHandlers.deletePlace);
  app.post('/travel/places/open', travelHandlers.openPlace);
  app.post('/travel/places/find', travelHandlers.findPlaces);
  app.post('/travel/places/guide', travelHandlers.findPlaceGuide);
  app.post('/travel/places/children/find', travelHandlers.findChildren);
  app.post('/travel/cities/find', travelHandlers.findCity);
  app.post('/travel/places/image', travelHandlers.generatePlaceHeroImage);
  app.post('/travel/places/search', travelHandlers.searchPlaces);
  app.post('/travel/places/references/generate', travelHandlers.generatePlaceReference);
  app.post('/travel/places/references/list', travelHandlers.listPlaceReferences);
  app.post('/travel/trips/list', travelHandlers.listTrips);
  app.post('/travel/trips/search', travelHandlers.searchTrips);
  app.post('/travel/trips/guides/generate', travelHandlers.generateTripGuide);
  app.post('/travel/trips/guides/list', travelHandlers.listTripGuides);
  app.post('/travel/trips', travelHandlers.createTrip);
  app.post('/travel/trips/update', travelHandlers.updateTrip);
  app.post('/travel/trips/delete', travelHandlers.deleteTrip);
  app.post('/travel/trips/attachments/set', travelHandlers.setTripAttachments);
  app.post('/app/enhance', appTransformationHandlers.enhance);
  app.post('/app/translate', appTransformationHandlers.translate);
  app.post('/app/speech', appSpeechHandler);
  app.post('/email/overview', emailHandlers.overview);
  app.post('/email/inboxes/search', emailHandlers.searchInboxes);
  app.post('/email/tones/search', emailHandlers.searchTones);
  app.post('/email/connect', emailHandlers.startConnect);
  app.get('/email/connectors/gmail/callback', emailHandlers.callback);
  app.post('/email/connect/exchange', emailHandlers.exchangeConnect);
  app.post('/email/sync', emailHandlers.sync);
  app.post('/email/subscribe', emailHandlers.subscribe);
  app.post('/email/threads/favorite', emailHandlers.favoriteBulk);
  app.post('/email/threads/read-state', emailHandlers.readStateBulk);
  app.post('/email/threads/trash', emailHandlers.trashThreads);
  app.post('/email/threads/:threadKey', emailHandlers.thread);
  app.post('/email/threads/:threadKey/favorite', emailHandlers.favorite);
  app.post('/email/threads/:threadKey/read-state', emailHandlers.readState);
  app.post('/email/threads/:threadKey/trash', emailHandlers.trashThread);
  app.post('/email/trash/clear', emailHandlers.clearTrash);
  app.post('/email/messages/:messageKey/similar', emailHandlers.findSimilar);
  app.post('/email/messages/:messageKey/translations/list', emailHandlers.listMessageTranslations);
  app.delete('/email/messages/:messageKey/translations', emailHandlers.deleteMessageTranslations);
  app.post('/email/messages/:messageKey/summaries', emailHandlers.summarizeMessage);
  app.post('/email/messages/:messageKey/summaries/list', emailHandlers.listMessageSummaries);
  app.delete('/email/messages/:messageKey/summaries', emailHandlers.deleteMessageSummaries);
  app.post('/email/drafts', emailHandlers.draft);
  app.post('/email/drafts/compose', emailHandlers.draftNew);
  app.post('/email/tones/list', emailHandlers.tones);
  app.post('/email/reply-context/list', emailHandlers.listReplyContext);
  app.post('/email/reply-context', emailHandlers.createReplyContext);
  app.patch('/email/reply-context/:noteKey', emailHandlers.updateReplyContext);
  app.post('/email/reply-context/delete', emailHandlers.deleteReplyContext);
  app.post('/email/tones', emailHandlers.createTone);
  app.patch('/email/tones/:toneKey', emailHandlers.updateTone);
  app.delete('/email/tones/:toneKey', emailHandlers.deleteTone);
  app.patch('/email/inboxes', emailHandlers.updateInbox);
  app.patch('/email/drafts/:draftKey', emailHandlers.updateDraft);
  app.delete('/email/drafts/:draftKey', emailHandlers.deleteDraft);
  app.post('/email/drafts/:draftKey/assign', emailHandlers.assignDraft);
  app.post('/email/drafts/:draftKey/send', emailHandlers.sendDraft);
  app.post('/email/disconnect', emailHandlers.disconnect);
  app.post('/books/overview', bookHandlers.overview);
  app.post('/books/topic-suggestions', bookHandlers.topicSuggestions);
  app.post('/books/goal-suggestions', bookHandlers.goalSuggestions);
  app.post('/assistant/respond', respondToAssistant);
  app.post('/books', bookHandlers.create);
  app.post('/books/:bookKey/detail', bookHandlers.detail);
  app.post('/books/:bookKey/extension/preview', bookHandlers.extensionPreview);
  app.post('/books/:bookKey/extension', bookHandlers.extensionGenerate);
  app.patch('/books/:bookKey/chapters/:chapterKey/progress', bookHandlers.progress);
  app.post('/books/:bookKey/retry', bookHandlers.retry);
  app.post('/books/:bookKey/cancel', bookHandlers.cancel);
  app.post('/books/:bookKey/favorite', bookHandlers.setFavorite);
  app.delete('/books/:bookKey', bookHandlers.delete);

  app.get('/founders/me', getFoundersAccount);
  app.get('/founders/teams', listFoundersTeams);
  app.get('/founders/teams/:teamKey/scopes', listFoundersTeamScopes);
  app.get('/founders/teams/:teamKey/communication/channels', communicationHandlers.listChannels);
  app.get('/founders/teams/:teamKey/communication/channels/:channelKey/messages', communicationHandlers.listMessages);
  app.get('/founders/teams/:teamKey/communication/channels/:channelKey/typing', communicationHandlers.typingStream);
  app.post('/founders/teams/:teamKey/communication/channels/:channelKey/typing', communicationHandlers.typing);
  app.delete('/founders/teams/:teamKey/communication/channels/:channelKey/messages/:messageKey', communicationHandlers.deleteMessage);
  app.patch('/founders/teams/:teamKey/communication/channels/:channelKey/messages/:messageKey', communicationHandlers.editMessage);
  app.post('/founders/teams/:teamKey/communication/channels/:channelKey/messages', communicationHandlers.postMessage);
  app.post('/founders/teams/:teamKey/communication/channels/:channelKey/messages/:messageKey/reactions', communicationHandlers.react);
  app.get('/founders/teams/:teamKey/communication/channels/:channelKey/messages/:messageKey/replies', communicationHandlers.readReplies);
  app.get('/founders/teams/:teamKey/communication/reactions', communicationHandlers.frequentReactions);
  app.post('/founders/teams/:teamKey/communication/channels/:channelKey/polls', communicationHandlers.createPoll);
  app.get('/founders/teams/:teamKey/communication/channels/:channelKey/polls/:pollKey', communicationHandlers.readPoll);
  app.post('/founders/teams/:teamKey/communication/channels/:channelKey/polls/:pollKey/votes', communicationHandlers.votePoll);
  app.post('/founders/teams/:teamKey/communication/channels/:channelKey/polls/:pollKey/close', communicationHandlers.closePoll);

  app.get('/system/orchestrators', listSystemOrchestrators);
  app.post('/system/orchestrators', createSystemOrchestrator);
  app.patch('/system/orchestrators/:orchestratorId', updateSystemOrchestrator);

}
