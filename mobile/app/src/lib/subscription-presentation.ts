import type { CurrentSubscription } from "./billing-client";
import type { MobileProduct } from "./product-client";

export type SubscriptionAction = "cancel" | "restore" | null;

export function subscriptionPresentation(subscription: CurrentSubscription, product: MobileProduct | undefined) {
  const title = product?.type === "subscription"
    ? `${product.billingPeriod === "week" ? "Weekly" : "Monthly"} plan`
    : "Subscription";
  const periodEnd = subscription.currentPeriodEnd ? new Date(subscription.currentPeriodEnd).toLocaleDateString() : undefined;
  const scheduled = subscription.cancelAtPeriodEnd;

  if (subscription.status === "active" || subscription.status === "trialing") {
    return scheduled
      ? { title, copy: `Active until${periodEnd ? ` ${periodEnd}` : " the end of this billing period"}; renewal is canceled.`, action: "restore" as SubscriptionAction }
      : { title, copy: `Renews automatically${periodEnd ? ` on ${periodEnd}` : " at the end of this billing period"}.`, action: "cancel" as SubscriptionAction };
  }
  if (subscription.status === "past_due") {
    return scheduled
      ? { title, copy: "Payment is past due and renewal is canceled. Access depends on resolving billing before the period ends.", action: "restore" as SubscriptionAction }
      : { title, copy: "Payment is past due. Renewal and access depend on a successful payment.", action: "cancel" as SubscriptionAction };
  }
  const copy = {
    canceled: "This subscription is canceled and will not renew.",
    unpaid: "This subscription is unpaid and will not renew unless billing is resolved.",
    paused: "This subscription is paused and is not currently renewing.",
    incomplete: "This subscription is awaiting payment confirmation and is not active yet.",
    incomplete_expired: "This incomplete subscription expired and will not renew.",
  }[subscription.status];
  return { title, copy, action: null as SubscriptionAction };
}
