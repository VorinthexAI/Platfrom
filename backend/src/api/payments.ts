import type { Context } from 'hono';
import { z } from 'zod';
import { getUserByEmailHash, getUserById, type User } from '@/lib/db/users.node';
import {
  getPaymentCheckoutById,
  getPaymentCheckoutByProviderCheckoutId,
  getPaymentCheckoutByUserAndIdempotencyKey,
  insertPaymentCheckout,
  updatePaymentCheckout,
  type PaymentCheckout,
} from '@/lib/db/payment-checkouts.node';
import {
  getPaymentOrderByProviderOrderId,
  insertPaymentOrder,
  updatePaymentOrder,
} from '@/lib/db/payment-orders.node';
import {
  getProductById,
  getProductByPolarProductId,
  listAllProducts,
  updateProduct,
  type Product,
} from '@/lib/db/products.node';
import {
  getSubscriptionByProviderSubscriptionId,
  hasSubscriptionInStatuses,
  insertSubscription,
  updateSubscription,
} from '@/lib/db/subscriptions.node';
import {
  getUserEntitlementBySource,
  listEntitlementsByUserId,
  revokeCompetingActiveEntitlements,
  revokeOtherActiveSubscriptionEntitlements,
  updateUserEntitlement,
  upsertEntitlementBySource,
} from '@/lib/db/user-entitlements.node';
import {
  claimWebhookEvent,
  deleteProcessedWebhookEventByProviderAndEventId,
  updateProcessedWebhookEventByProviderAndEventId,
} from '@/lib/db/processed-webhook-events.node';
import { isArangoUniqueConstraintError } from '@/lib/db/base';
import { newId } from '@/lib/ids';
import { createPolarCheckout, createPolarProduct, listPolarProducts, updatePolarProduct, verifyPolarWebhookSignature } from '@/lib/polar';
import { sendBrandedEmail } from './email';
import { getUserId } from './security';
import { parseJson, strictObject } from './validation';
import { defaultNameFromEmail } from './users';
import { trackPlatformEvent } from '@/platform/events';

export const POLAR_WEBHOOK_PATH = '/webhooks/polar';
export const POLAR_WEBHOOK_FULL_PATH = `/api/v1${POLAR_WEBHOOK_PATH}`;
export const POLAR_WEBHOOK_PUBLIC_PATHS = [POLAR_WEBHOOK_PATH, POLAR_WEBHOOK_FULL_PATH] as const;

export function isPolarWebhookPath(path: string) {
  const normalized = path.length > 1 ? path.replace(/\/+$/, '') : path;
  return POLAR_WEBHOOK_PUBLIC_PATHS.some((candidate) => normalized === candidate);
}

const BLOCKING_SUBSCRIPTION_STATUSES = ['active', 'trialing', 'past_due'] as const;
const WEBHOOK_CLAIM_STALE_MS = 5 * 60 * 1000;
const emailHashSchema = z.string().regex(/^[a-f0-9]{64}$/);
const PRIVATE_BETA_TICKET_PRODUCT_ID = 'private.beta.access.ticket';

const checkoutBodySchema = strictObject({
  product_id: z.string().min(1),
  email_hash: emailHashSchema.optional(),
});

function getClientIp(c: Context) {
  // x-forwarded-for is client-controlled unless a trusted proxy strips it, and
  // this value is forwarded to Polar for tax/fraud decisions — only use
  // headers set by our own edge.
  return c.req.header('cf-connecting-ip')
    ?? c.req.header('x-real-ip')
    ?? undefined;
}

function appUrl(path: string) {
  const frontendUrl = process.env.FRONTEND_URL ?? 'http://localhost:3000';
  return new URL(path, frontendUrl).toString();
}

function escapeHtml(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function userFirstName(input: { email: string; name?: string | null }) {
  return escapeHtml(input.name?.trim() || defaultNameFromEmail(input.email) || 'there');
}

function parseDate(value: unknown) {
  if (typeof value !== 'string') return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function parseAmountCents(value: unknown) {
  const amount = Number(value ?? 0);
  return Number.isFinite(amount) ? Math.max(0, Math.round(amount)) : 0;
}

function stringFromMetadata(metadata: unknown, key: string) {
  if (!metadata || typeof metadata !== 'object') return null;
  const value = (metadata as Record<string, unknown>)[key];
  return typeof value === 'string' ? value : null;
}

function resolveWebhookUserId(data: Record<string, any>) {
  return data.customer?.external_id
    ?? data.customer?.externalId
    ?? stringFromMetadata(data.metadata, 'userId')
    ?? null;
}

async function findProductByPolarId(polarProductId: string | undefined | null): Promise<Product | null> {
  if (!polarProductId) return null;
  return getProductByPolarProductId(polarProductId);
}

// Resolves the webhook's user reference to an existing row so inserts cannot
// hit a foreign-key violation and wedge the event in a permanent retry loop.
async function findWebhookUser(data: Record<string, any>) {
  const userId = resolveWebhookUserId(data);
  if (!userId) return null;
  const user = await getUserById(userId);
  if (!user) console.warn('polar webhook references unknown user', { userId });
  return user ?? null;
}

async function deliverPrivateBetaTicketEmail(input: { email: string; name?: string | null }) {
  const name = userFirstName(input);
  await sendBrandedEmail({
    from: process.env.ADMIN_EMAIL,
    to: input.email,
    subject: 'Your Vorinthex ticket is confirmed',
    preheader: 'Your Private Beta ticket is confirmed. Receipt will arrive separately.',
    label: 'Ticket',
    eyebrow: 'Private beta',
    headline: 'Your ticket is confirmed',
    bodyHtml: [
      `<p style="margin:0 0 16px;">Hi ${name},</p>`,
      '<p style="margin:0 0 16px;">You are in.</p>',
      '<p style="margin:0 0 16px;">Thank you for believing in us early.</p>',
      '<p style="margin:0 0 16px;">By buying this ticket, you secure the option to be offered Private Beta access at $799/month when we launch. Free waitlist members will be selected at random: only 25 free members, plus ticket holders, will be invited into the first private beta.</p>',
      '<p style="margin:0;">Your receipt will be sent separately. More signals soon.</p>',
    ].join(''),
    actionUrl: appUrl('/'),
    actionLabel: 'Open Vorinthex',
    supportingHtml: 'Vorinthex is being built in stealth mode. Keep this email for your records.',
    footerHtml: 'You received this because this email address purchased a Vorinthex Private Beta ticket.',
  });
}

async function grantEntitlement(input: {
  userId: string;
  productId: string;
  sourceType: 'order' | 'subscription';
  sourceId: string;
  endsAt?: Date | null;
}) {
  if (input.sourceType === 'subscription') {
    await revokeOtherActiveSubscriptionEntitlements(input.userId, input.sourceId);
  }

  await revokeCompetingActiveEntitlements(input.userId, input.productId, input.sourceType, input.sourceId);

  await upsertEntitlementBySource({
    newId: newId(),
    userId: input.userId,
    productId: input.productId,
    sourceType: input.sourceType,
    sourceId: input.sourceId,
    endsAt: input.endsAt ? input.endsAt.toISOString() : null,
  });
}

async function revokeEntitlement(sourceType: 'order' | 'subscription', sourceId: string) {
  const existing = await getUserEntitlementBySource(sourceType, sourceId);
  if (!existing) return;
  await updateUserEntitlement(existing.key, { status: 'revoked', updatedAt: new Date().toISOString() });
}

type WebhookClaim = 'claimed' | 'duplicate' | 'in_progress';

async function claimWebhookEventForProcessing(provider: 'polar', eventId: string, eventType: string): Promise<WebhookClaim> {
  return claimWebhookEvent(provider, eventId, eventType, WEBHOOK_CLAIM_STALE_MS);
}

async function completeWebhookEvent(provider: 'polar', eventId: string) {
  await updateProcessedWebhookEventByProviderAndEventId(provider, eventId, { status: 'processed', processedAt: new Date().toISOString() });
}

async function releaseWebhookEvent(provider: 'polar', eventId: string) {
  await deleteProcessedWebhookEventByProviderAndEventId(provider, eventId);
}

async function finalizeCheckoutWithProvider(c: Context, input: {
  checkoutId: string;
  user: { id: string; email: string };
  product: { productId: string; polarProductId: string };
}) {
  const { checkoutId, user, product } = input;
  try {
    const checkout = await createPolarCheckout({
      productId: product.polarProductId,
      customerEmail: user.email,
      externalCustomerId: user.id,
      customerIpAddress: getClientIp(c),
      successUrl: appUrl(`/checkout/success?checkout_id=${checkoutId}`),
      returnUrl: appUrl('/checkout/cancel'),
      metadata: {
        userId: user.id,
        productId: product.productId,
        checkoutId,
      },
    });

    await updatePaymentCheckout(checkoutId, {
      providerCheckoutId: checkout.id,
      checkoutUrl: checkout.url,
      status: 'created',
      updatedAt: new Date().toISOString(),
    });
    trackPlatformEvent({
      slug: 'payment.checkout_created',
      userId: user.id,
      data: {
        checkout_id: checkoutId,
        provider_checkout_id: checkout.id,
        user_id: user.id,
        product_id: product.productId,
      },
    });

    return c.json({
      checkout_id: checkoutId,
      checkout_url: checkout.url,
      provider_checkout_id: checkout.id,
      reused: false,
    }, 201);
  } catch (error) {
    await updatePaymentCheckout(checkoutId, {
      status: 'failed',
      updatedAt: new Date().toISOString(),
      metadata: { error: error instanceof Error ? error.message : String(error) },
    });
    throw error;
  }
}

export async function createPaymentCheckout(c: Context) {
  const idempotencyKey = c.req.header('idempotency-key');
  if (!idempotencyKey) return c.json({ error: 'Idempotency-Key header is required' }, 400);
  if (idempotencyKey.length > 200) return c.json({ error: 'Idempotency-Key header is too long' }, 400);

  const body = await parseJson(c, checkoutBodySchema);
  const userId = await getUserId(c);
  let user: User | null = null;
  if (userId) {
    user = await getUserById(userId);
    if (!user) return c.json({ error: 'authenticated user not found' }, 401);
  } else if (body.email_hash) {
    user = await getUserByEmailHash(body.email_hash);
    if (!user) return c.json({ error: 'user not found for email_hash' }, 403);
  } else {
    return c.json({ error: 'authentication or email_hash required' }, 401);
  }

  const products = await listAllProducts();
  const product = products.find((candidate) => candidate.productId === body.product_id) ?? null;
  if (!product) return c.json({ error: 'product not found' }, 404);
  if (product.priceCents === 0) return c.json({ error: 'free products do not require checkout' }, 400);
  if (!product.polarProductId) return c.json({ error: 'product is not linked to Polar; run polar sync before checkout' }, 409);

  if (product.type === 'subscription') {
    // 'canceled' subscriptions do not block: the user keeps access until the
    // period ends, but must be able to start a new subscription right away.
    if (await hasSubscriptionInStatuses(user.key, [...BLOCKING_SUBSCRIPTION_STATUSES])) {
      return c.json({ error: 'user already has an active subscription' }, 409);
    }
  }

  const linkedProduct = { productId: product.productId, polarProductId: product.polarProductId };
  const userRef = { id: user.key, email: user.email };

  const checkoutId = newId();
  let insertedCheckout: PaymentCheckout | null = null;
  try {
    insertedCheckout = await insertPaymentCheckout({
      key: checkoutId,
      userId: user.key,
      productId: product.key,
      idempotencyKey,
      status: 'pending',
      metadata: { productId: product.productId },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
  } catch (err) {
    if (!isArangoUniqueConstraintError(err)) throw err;
  }

  if (!insertedCheckout) {
    const existing = await getPaymentCheckoutByUserAndIdempotencyKey(user.key, idempotencyKey);
    if (!existing) return c.json({ error: 'checkout idempotency conflict' }, 409);
    if (existing.productId !== product.key) {
      return c.json({ error: 'Idempotency-Key was already used for another product' }, 409);
    }
    if (existing.checkoutUrl && existing.providerCheckoutId) {
      return c.json({
        checkout_id: existing.key,
        checkout_url: existing.checkoutUrl,
        provider_checkout_id: existing.providerCheckoutId,
        reused: true,
      });
    }
    if (existing.status === 'failed') {
      // Reclaim the failed attempt so a transient provider error does not
      // permanently burn this idempotency key.
      const reclaimed = await updatePaymentCheckout(existing.key, {
        status: 'pending',
        metadata: { productId: product.productId },
        updatedAt: new Date().toISOString(),
      });
      if (reclaimed.status !== 'pending') {
        return c.json({ error: 'checkout creation is in progress; retry with the same Idempotency-Key' }, 409);
      }
      return finalizeCheckoutWithProvider(c, { checkoutId: existing.key, user: userRef, product: linkedProduct });
    }
    return c.json({ error: 'checkout creation is in progress; retry with the same Idempotency-Key' }, 409);
  }

  return finalizeCheckoutWithProvider(c, { checkoutId, user: userRef, product: linkedProduct });
}

function isPartialRefund(data: Record<string, any>) {
  if (String(data.status ?? '') === 'partially_refunded') return true;
  const refundedAmount = Number(data.refunded_amount ?? data.refundedAmount ?? NaN);
  const totalAmount = Number(data.total_amount ?? data.totalAmount ?? NaN);
  return Number.isFinite(refundedAmount) && Number.isFinite(totalAmount) && refundedAmount < totalAmount;
}

async function fulfillOrderPaid(data: Record<string, any>) {
  const providerOrderId = String(data.id ?? '');
  if (!providerOrderId) throw new Error('Polar order.paid is missing data.id');

  const product = await findProductByPolarId(data.product_id ?? data.productId);
  const user = await findWebhookUser(data);
  const checkoutProviderId = typeof data.checkout_id === 'string' ? data.checkout_id : null;
  const checkoutInternalId = stringFromMetadata(data.metadata, 'checkoutId');
  const paidAt = parseDate(data.created_at) ?? new Date();

  const checkout = checkoutProviderId
    ? await getPaymentCheckoutByProviderCheckoutId('polar', checkoutProviderId)
    : checkoutInternalId
      ? await getPaymentCheckoutById(checkoutInternalId)
      : null;

  let inserted = true;
  try {
    await insertPaymentOrder({
      key: newId(),
      userId: user?.key ?? null,
      productId: product?.key ?? null,
      checkoutId: checkout?.key ?? null,
      providerOrderId,
      providerSubscriptionId: data.subscription_id ?? data.subscriptionId ?? null,
      amountCents: parseAmountCents(data.total_amount ?? data.totalAmount),
      currency: String(data.currency ?? 'usd').toLowerCase(),
      status: 'paid',
      paidAt: paidAt.toISOString(),
      rawEvent: data,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
  } catch (err) {
    if (!isArangoUniqueConstraintError(err)) throw err;
    inserted = false;
  }

  if (checkout) {
    await updatePaymentCheckout(checkout.key, { status: 'paid', updatedAt: new Date().toISOString() });
    trackPlatformEvent({
      slug: 'payment.checkout_completed',
      userId: user?.key ?? null,
      data: {
        checkout_id: checkout.key,
        provider_checkout_id: checkout.providerCheckoutId,
        provider_order_id: providerOrderId,
        user_id: user?.key ?? null,
        product_id: product?.productId ?? null,
      },
    });
  }

  let shouldGrant = inserted;
  if (!shouldGrant) {
    // A refund event that arrived first leaves a tombstone row; a full refund
    // must keep winning, but a partial refund still entitles the buyer.
    const existing = await getPaymentOrderByProviderOrderId('polar', providerOrderId);
    if (existing && existing.status === 'partially_refunded' && !existing.paidAt) {
      await updatePaymentOrder(existing.key, { paidAt: paidAt.toISOString(), updatedAt: new Date().toISOString() });
      shouldGrant = true;
    }
  }

  if (!shouldGrant || !product || !user) return;
  if (product.type === 'one_time') {
    await grantEntitlement({
      userId: user.key,
      productId: product.key,
      sourceType: 'order',
      sourceId: providerOrderId,
    });
    if (product.productId === PRIVATE_BETA_TICKET_PRODUCT_ID) {
      trackPlatformEvent({
        slug: 'payment.ticket_purchased',
        userId: user.key,
        data: {
          user_id: user.key,
          product_id: product.productId,
          provider_order_id: providerOrderId,
          checkout_id: checkout?.key ?? null,
        },
      });
      await deliverPrivateBetaTicketEmail({ email: user.email, name: user.name }).catch((error) => {
        console.warn('failed to send private beta ticket confirmation email', {
          userId: user.key,
          providerOrderId,
          error: error instanceof Error ? error.message : String(error),
        });
      });
    }
  }
}

async function fulfillOrderRefunded(data: Record<string, any>) {
  const providerOrderId = String(data.id ?? '');
  if (!providerOrderId) throw new Error('Polar order.refunded is missing data.id');

  const partial = isPartialRefund(data);
  const status = partial ? ('partially_refunded' as const) : ('refunded' as const);
  const product = await findProductByPolarId(data.product_id ?? data.productId);
  const user = await findWebhookUser(data);

  // Upsert so a refund that beats its order.paid event leaves a tombstone row;
  // the later paid event then conflicts and cannot grant an entitlement.
  const doc = {
    userId: user?.key ?? null,
    productId: product?.key ?? null,
    checkoutId: null,
    providerOrderId,
    providerSubscriptionId: data.subscription_id ?? data.subscriptionId ?? null,
    amountCents: parseAmountCents(data.total_amount ?? data.totalAmount),
    currency: String(data.currency ?? 'usd').toLowerCase(),
    status,
    refundedAt: new Date().toISOString(),
    rawEvent: data,
    updatedAt: new Date().toISOString(),
  };
  const existing = await getPaymentOrderByProviderOrderId('polar', providerOrderId);
  if (existing) {
    await updatePaymentOrder(existing.key, doc);
  } else {
    try {
      await insertPaymentOrder({ key: newId(), createdAt: new Date().toISOString(), ...doc });
    } catch (err) {
      if (!isArangoUniqueConstraintError(err)) throw err;
      const racedExisting = await getPaymentOrderByProviderOrderId('polar', providerOrderId);
      if (racedExisting) await updatePaymentOrder(racedExisting.key, doc);
    }
  }

  if (!partial) {
    await revokeEntitlement('order', providerOrderId);
  }
}

type ActiveSubscriptionStatus = 'active' | 'trialing' | 'past_due';

async function fulfillSubscriptionActive(data: Record<string, any>, status: ActiveSubscriptionStatus) {
  const providerSubscriptionId = String(data.id ?? '');
  if (!providerSubscriptionId) throw new Error('Polar subscription event is missing data.id');

  const product = await findProductByPolarId(data.product_id ?? data.productId);
  const user = await findWebhookUser(data);
  if (!product || !user) {
    console.warn('polar subscription event could not be matched to a product and user', { providerSubscriptionId });
    return;
  }

  // 'revoked' is terminal: a late or out-of-order activation event must not
  // resurrect the subscription or its entitlement.
  const existing = await getSubscriptionByProviderSubscriptionId('polar', providerSubscriptionId);
  if (existing?.status === 'revoked') {
    console.warn('ignoring activation event for revoked subscription', { providerSubscriptionId });
    return;
  }

  const currentPeriodEnd = parseDate(data.current_period_end ?? data.currentPeriodEnd);
  const gracePeriodEnd = status === 'past_due'
    ? new Date(Date.now() + (product.gracePeriod ?? 7) * 24 * 60 * 60 * 1000)
    : null;

  const subscriptionDoc = {
    userId: user.key,
    productId: product.key,
    providerSubscriptionId,
    status,
    currentPeriodStart: parseDate(data.current_period_start ?? data.currentPeriodStart)?.toISOString() ?? null,
    currentPeriodEnd: currentPeriodEnd?.toISOString() ?? null,
    cancelAtPeriodEnd: Boolean(data.cancel_at_period_end ?? data.cancelAtPeriodEnd),
    canceledAt: parseDate(data.canceled_at ?? data.canceledAt)?.toISOString() ?? null,
    gracePeriodEnd: gracePeriodEnd?.toISOString() ?? null,
    rawEvent: data,
    updatedAt: new Date().toISOString(),
  };

  if (existing) {
    await updateSubscription(existing.key, subscriptionDoc);
  } else {
    try {
      await insertSubscription({ key: newId(), createdAt: new Date().toISOString(), ...subscriptionDoc });
    } catch (err) {
      if (!isArangoUniqueConstraintError(err)) throw err;
      const racedExisting = await getSubscriptionByProviderSubscriptionId('polar', providerSubscriptionId);
      if (racedExisting) await updateSubscription(racedExisting.key, subscriptionDoc);
    }
  }

  await grantEntitlement({
    userId: user.key,
    productId: product.key,
    sourceType: 'subscription',
    sourceId: providerSubscriptionId,
    endsAt: status === 'past_due' ? gracePeriodEnd ?? currentPeriodEnd : currentPeriodEnd,
  });
}

async function fulfillSubscriptionCanceled(data: Record<string, any>) {
  const providerSubscriptionId = String(data.id ?? '');
  if (!providerSubscriptionId) throw new Error('Polar subscription.canceled is missing data.id');

  const endsAt = parseDate(data.ends_at ?? data.endsAt ?? data.current_period_end ?? data.currentPeriodEnd);
  const existing = await getSubscriptionByProviderSubscriptionId('polar', providerSubscriptionId);
  if (existing) {
    await updateSubscription(existing.key, {
      status: 'canceled',
      cancelAtPeriodEnd: true,
      canceledAt: (parseDate(data.canceled_at ?? data.canceledAt) ?? new Date()).toISOString(),
      ...(endsAt ? { currentPeriodEnd: endsAt.toISOString() } : {}),
      rawEvent: data,
      updatedAt: new Date().toISOString(),
    });
  }

  // Access lasts until the period ends, but cancellation can shorten that
  // window — keep the entitlement's expiry in sync with it.
  if (endsAt) {
    const entitlement = await getUserEntitlementBySource('subscription', providerSubscriptionId);
    if (entitlement && entitlement.status === 'active') {
      await updateUserEntitlement(entitlement.key, { endsAt: endsAt.toISOString(), updatedAt: new Date().toISOString() });
    }
  }
}

async function fulfillSubscriptionRevoked(data: Record<string, any>) {
  const providerSubscriptionId = String(data.id ?? '');
  if (!providerSubscriptionId) throw new Error('Polar subscription.revoked is missing data.id');
  const existing = await getSubscriptionByProviderSubscriptionId('polar', providerSubscriptionId);
  if (existing) {
    await updateSubscription(existing.key, { status: 'revoked', rawEvent: data, updatedAt: new Date().toISOString() });
  }
  await revokeEntitlement('subscription', providerSubscriptionId);
}

async function fulfillCheckoutUpdated(data: Record<string, any>) {
  const providerCheckoutId = String(data.id ?? '');
  if (!providerCheckoutId) return;

  const status = String(data.status ?? '');
  const mapped = status === 'expired' ? ('expired' as const) : status === 'failed' ? ('failed' as const) : null;
  if (!mapped) return;

  const existing = await getPaymentCheckoutByProviderCheckoutId('polar', providerCheckoutId);
  if (existing && (existing.status === 'pending' || existing.status === 'created')) {
    await updatePaymentCheckout(existing.key, { status: mapped, updatedAt: new Date().toISOString() });
  }
}

export async function processPolarWebhookPayload(payload: Record<string, any>) {
  const eventType = String(payload.type ?? '');
  const data = payload.data as Record<string, any> | undefined;
  if (!eventType || !data) throw new Error('invalid Polar webhook payload');

  switch (eventType) {
    case 'order.created':
    case 'checkout.created':
      return { ignored: true };
    case 'checkout.updated':
      await fulfillCheckoutUpdated(data);
      return { processed: true };
    case 'order.paid':
      await fulfillOrderPaid(data);
      return { processed: true };
    case 'order.refunded':
      await fulfillOrderRefunded(data);
      return { processed: true };
    case 'subscription.created':
    case 'subscription.active':
    case 'subscription.updated':
    case 'subscription.uncanceled': {
      // Polar reuses subscription.updated for every lifecycle change; dispatch
      // on the payload status so a late event cannot mark a canceled or
      // revoked subscription active again.
      const status = String(data.status ?? 'active');
      if (status === 'active' || status === 'trialing' || status === 'past_due') {
        await fulfillSubscriptionActive(data, status);
      } else if (status === 'canceled') {
        await fulfillSubscriptionCanceled(data);
      } else if (status === 'revoked' || status === 'unpaid' || status === 'incomplete_expired') {
        await fulfillSubscriptionRevoked(data);
      } else {
        return { ignored: true };
      }
      return { processed: true };
    }
    case 'subscription.canceled':
      await fulfillSubscriptionCanceled(data);
      return { processed: true };
    case 'subscription.revoked':
      await fulfillSubscriptionRevoked(data);
      return { processed: true };
    default:
      return { ignored: true };
  }
}

export async function handlePolarWebhook(c: Context) {
  const rawBody = await c.req.text();
  const webhookId = c.req.header('webhook-id');
  const verified = await verifyPolarWebhookSignature({
    rawBody,
    webhookId,
    webhookTimestamp: c.req.header('webhook-timestamp'),
    webhookSignature: c.req.header('webhook-signature'),
  });
  if (!verified) return c.json({ error: 'invalid webhook signature' }, 403);
  if (!webhookId) return c.json({ error: 'webhook-id header is required' }, 400);

  const payload = JSON.parse(rawBody) as Record<string, any>;
  const eventType = String(payload.type ?? 'unknown');
  const claim = await claimWebhookEventForProcessing('polar', webhookId, eventType);
  if (claim === 'duplicate') return c.json({ ok: true, duplicate: true });
  if (claim === 'in_progress') {
    // Non-2xx so the provider retries after the concurrent attempt settles;
    // acknowledging here could lose the event if that attempt fails.
    return c.json({ error: 'event is already being processed' }, 409);
  }

  try {
    await processPolarWebhookPayload(payload);
    await completeWebhookEvent('polar', webhookId);
    return c.json({ ok: true });
  } catch (error) {
    await releaseWebhookEvent('polar', webhookId);
    throw error;
  }
}

export async function syncPolarProducts() {
  const rows = await listAllProducts();
  const results = [];

  const toPolarProductInput = (product: Product) => ({
    name: product.name,
    type: product.type,
    priceCents: product.priceCents,
    billingPeriod: product.billingPeriod,
    metadata: {
      app: 'vorinthex',
      internalProductId: product.key,
      productId: product.productId,
      type: product.type,
    },
  });

  // Re-link products that were already created in the currently configured
  // Polar account instead of creating duplicates. The stored polarProductId may
  // point at another Polar environment, for example after switching from
  // sandbox to production, so never trust it unless the current account lists it.
  const polarByInternalId = new Map<string, string>();
  const polarById = new Set<string>();
  for (const polarProduct of await listPolarProducts()) {
    polarById.add(polarProduct.id);
    const internalId = polarProduct.metadata.internalProductId;
    if (typeof internalId === 'string' && !polarByInternalId.has(internalId)) {
      polarByInternalId.set(internalId, polarProduct.id);
    }
  }

  for (const product of rows) {
    if (product.polarProductId && polarById.has(product.polarProductId)) {
      await updatePolarProduct(product.polarProductId, toPolarProductInput(product));
      results.push({ product_id: product.productId, status: 'updated', polar_product_id: product.polarProductId });
      continue;
    }

    const existingPolarId = polarByInternalId.get(product.key);
    if (existingPolarId) {
      await updateProduct(product.key, { polarProductId: existingPolarId, updatedAt: new Date().toISOString() });
      await updatePolarProduct(existingPolarId, toPolarProductInput(product));
      const status = product.polarProductId ? 'environment_relinked_updated' : 'relinked_updated';
      results.push({ product_id: product.productId, status, polar_product_id: existingPolarId });
      continue;
    }

    const polarProduct = await createPolarProduct(toPolarProductInput(product));
    await updateProduct(product.key, { polarProductId: polarProduct.id, updatedAt: new Date().toISOString() });
    const status = product.polarProductId ? 'environment_relinked_created' : 'created';
    results.push({ product_id: product.productId, status, polar_product_id: polarProduct.id });
  }
  return results;
}

export async function listUserEntitlements(c: Context) {
  const userId = await getUserId(c);
  if (!userId) return c.json({ error: 'authentication required' }, 401);

  const entitlements = await listEntitlementsByUserId(userId);
  const rows = [];
  for (const entitlement of entitlements) {
    const product = await getProductById(entitlement.productId);
    if (!product) continue;
    rows.push({
      id: entitlement.key,
      product_id: product.productId,
      product_name: product.name,
      source_type: entitlement.sourceType,
      status: entitlement.status,
      starts_at: entitlement.startsAt,
      ends_at: entitlement.endsAt,
    });
  }
  return c.json(rows);
}
