import { useQuery, useQueryClient } from "@tanstack/react-query";
import { BottomSheet } from "@vorinthex/shared/ui/bottom-sheet";
import { Badge } from "@vorinthex/shared/ui/badge";
import { Button, ButtonSizeProvider } from "@vorinthex/shared/ui/button";
import { CloseIcon, HelpIcon, ReferralIcon, SparksIcon } from "@vorinthex/shared/ui/icons-mobile";
import { Tabs, TabsTrigger } from "@vorinthex/shared/ui/tabs";
import { useSessionToast as useToast } from "@/hooks/use-session-toast";
import * as Crypto from "expo-crypto";
import { LinearGradient } from "expo-linear-gradient";
import * as WebBrowser from "expo-web-browser";
import { useEffect, useRef, useState } from "react";
import { Animated, ScrollView, Share as NativeShare, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { ChromeIcon } from "@/components/ChromeIcon";
import { NeuralBackdrop } from "@/components/NeuralBackdrop";
import { OnboardingStepLayout } from "@/components/onboarding/OnboardingStepLayout";
import { SparkCostsSheet } from "@/components/SparkCostsSheet";
import { vorinthexMarkSource } from "@/data/capability-icons";
import { useCurrentSubscription, useWholeSparkBalance } from "@/hooks/use-billing-summary";
import { useDelayedAction } from "@/hooks/use-delayed-action";
import { currentSubscriptionQueryKey, formatWholeSparks, scheduleSubscriptionProduct, setSubscriptionCancellation } from "@/lib/billing-client";
import { completeCheckoutReturn } from "@/lib/checkout-return";
import { useErrorFeedback } from "@/hooks/use-error-feedback";
import { CHECKOUT_SUCCESS_URL, checkoutCallbackFromUrl, checkoutErrorMessage, createCheckout } from "@/lib/checkout-client";
import { activeSubscriptionOffers, activeTopup, effectivePriceCents, formatProductPrice, productSparkAmount, type MobileProduct } from "@/lib/product-client";
import { fetchReferralSummary, referralSummaryQueryKey } from "@/lib/referral-client";
import { recordOnboardingEvent } from "@/lib/onboarding-events";
import { useAppsStore } from "@/state/apps";
import { useAuthStore } from "@/state/auth";
import { useUiStore } from "@/state/ui";
import { fonts, palette, spacing } from "@/theme/tokens";

type PaywallMode = "onboarding" | "standard";
type Page = "plans" | "referral";
type OfferTab = "plans" | "topup";
type CheckoutState = "idle" | "opening";

function PlanCard({ current, endsAt, onSelect, product, selected }: { current: boolean; endsAt?: string; onSelect: () => void; product: MobileProduct; selected: boolean }) {
  const period = product.billingPeriod === "month" ? "month" : product.billingPeriod === "week" ? "week" : null;
  const sparkAmount = productSparkAmount(product);
  const bestValue = product.billingPeriod === "month";
  return <View style={styles.planWrap}>
    <Button accessibilityLabel={`${formatProductPrice(effectivePriceCents(product), product.currency)}${period ? ` per ${period}` : " one time"}, ${sparkAmount} Sparks`} accessibilityState={{ selected }} contentMode="raw" onPress={onSelect} shape="rounded" size="md" style={[styles.plan, selected && styles.planSelected]} variant="outline">
      <View style={styles.planValue}><Text style={styles.planGrant}>{sparkAmount.toLocaleString("en-US")} Sparks</Text><Text style={styles.planName}>{product.billingPeriod === "month" ? "Monthly plan" : product.billingPeriod === "week" ? "Weekly plan" : "One-time top-up"}</Text></View>
      <View style={styles.priceRow}>{product.discountedPriceCents !== null ? <Text accessibilityLabel={`Reference price ${formatProductPrice(product.priceCents, product.currency)}`} style={styles.referencePrice}>{formatProductPrice(product.priceCents, product.currency)}</Text> : null}<Text style={styles.price}>{formatProductPrice(effectivePriceCents(product), product.currency)}</Text>{period ? <Text style={styles.period}>/{period}</Text> : null}</View>
    </Button>
    {current ? <Badge accessibilityElementsHidden importantForAccessibility="no-hide-descendants" pointerEvents="none" style={styles.currentPlanBadge}><Text style={styles.currentPlanBadgeText}>{endsAt ? `Ends ${endsAt}` : "Current plan"}</Text></Badge> : bestValue ? <Badge accessibilityElementsHidden importantForAccessibility="no-hide-descendants" pointerEvents="none" style={styles.bestValueBadge}><Text style={styles.bestValueBadgeText}>Best value</Text></Badge> : null}
  </View>;
}

export function PaywallSheet({ initialPage = "plans", mode = "standard", onComplete }: { initialPage?: Page; mode?: PaywallMode; onComplete?: () => Promise<void> | void }) {
  const insets = useSafeAreaInsets();
  const { height, width } = useWindowDimensions();
  const onboardingHeroHeight = Math.max(280, height * 0.4);
  const standardOpen = useUiStore((state) => state.paywallOpen);
  const standardEntry = useUiStore((state) => state.paywallEntry);
  const onboardingReferralEntry = useUiStore((state) => state.onboardingReferralEntry);
  const closeStandard = useUiStore((state) => state.closePaywall);
  const open = mode === "onboarding" || standardOpen;
  const products = useAppsStore((state) => state.products);
  const productsStatus = useAppsStore((state) => state.productsStatus);
  const refreshProducts = useAppsStore((state) => state.refreshProducts);
  const userKey = useAuthStore((state) => state.user?.key);
  const authReferralSummary = useAuthStore((state) => state.referralSummary);
  const balance = useWholeSparkBalance(userKey).data;
  const subscriptionQuery = useCurrentSubscription(userKey);
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const subscriptions = activeSubscriptionOffers(products);
  const topup = activeTopup(products);
  const [page, setPage] = useState<Page>(initialPage);
  const [offerTab, setOfferTab] = useState<OfferTab>("plans");
  const offers = mode === "standard" ? offerTab === "plans" ? subscriptions : topup ? [topup] : [] : subscriptions;
  const [sparkCostsOpen, setSparkCostsOpen] = useState(false);
  const [selectedKey, setSelectedKey] = useState<string>();
  const [checkoutState, setCheckoutState] = useState<CheckoutState>("idle");
  const checkoutInFlight = useRef(false);
  const [message, setMessage] = useState<string>();
  const [completionError, setCompletionError] = useState<string>();
  const [sharing, setSharing] = useState(false);
  const [completing, setCompleting] = useState(false);
  const costDetailsOpen = sparkCostsOpen || (mode === "standard" && standardOpen && standardEntry === "costs");
  const recordedOnboardingPages = useRef(new Set<Page>());
  const delayedClose = useDelayedAction(mode === "onboarding" && open && page === "plans", page);
  const preferred = offers.find(({ productId }) => productId === "nova.monthly.discounted") ?? offers[0];
  const effectiveSelectedKey = offers.some(({ key }) => key === selectedKey) ? selectedKey : preferred?.key;
  const selected = offers.find(({ key }) => key === effectiveSelectedKey);
  const subscription = subscriptionQuery.data;
  const currentSubscriptionProductKey = subscription && ["active", "trialing", "past_due"].includes(subscription.status) ? subscription.productKey : undefined;
  const currentPlanEndDate = subscription?.cancelAtPeriodEnd && subscription.currentPeriodEnd ? new Date(subscription.currentPeriodEnd).toLocaleDateString() : undefined;
  const activePlan = subscription && ["active", "trialing"].includes(subscription.status);
  const selectedCurrentPlan = Boolean(selected && selected.key === currentSubscriptionProductKey);
  const renewalAction = Boolean(selected?.type === "subscription" && activePlan);
  const referral = useQuery({ queryKey: referralSummaryQueryKey(userKey ?? "unauthenticated"), queryFn: fetchReferralSummary, enabled: Boolean(userKey && open && (mode === "onboarding" || page === "referral")), initialData: authReferralSummary?.code.ownerUserKey === userKey ? authReferralSummary : undefined });
  useErrorFeedback(open ? [message, completionError, page === "referral" ? referral.error : undefined] : []);

  useEffect(() => {
    if (!open) {
      const reset = setTimeout(() => setSparkCostsOpen(false), 0);
      return () => clearTimeout(reset);
    }
    const reset = setTimeout(() => {
      setPage(initialPage);
      setOfferTab("plans");
      setSparkCostsOpen(mode === "standard" && standardEntry === "costs");
      setCheckoutState("idle");
      setMessage(undefined);
      setCompletionError(undefined);
    }, 0);
    return () => clearTimeout(reset);
  }, [initialPage, mode, open, standardEntry]);

  const setCostDetailsOpen = (next: boolean) => {
    setSparkCostsOpen(next);
    if (!next && mode === "standard" && standardEntry === "costs") closeStandard();
  };

  useEffect(() => {
    if (mode !== "onboarding" || !open || !onboardingReferralEntry) return;
    useUiStore.getState().consumeOnboardingReferralEntry();
    setPage("referral");
  }, [mode, onboardingReferralEntry, open]);

  useEffect(() => {
    if (mode !== "onboarding" || !open) return;
    if (recordedOnboardingPages.current.has(page)) return;
    recordedOnboardingPages.current.add(page);
    void recordOnboardingEvent(page === "plans" ? "onboarding.paywall" : "onboarding.referral").catch(() => undefined);
  }, [mode, open, page]);

  async function checkout() {
    if (!selected || !userKey || checkoutInFlight.current || checkoutState === "opening") return;
    if (selectedCurrentPlan && (!renewalAction || !subscription?.cancelAtPeriodEnd)) return;
    checkoutInFlight.current = true;
    setCheckoutState("opening");
    setMessage(undefined);
    try {
      if (renewalAction) {
        const updated = selectedCurrentPlan ? await setSubscriptionCancellation(false) : await scheduleSubscriptionProduct(selected.productId);
        queryClient.setQueryData(currentSubscriptionQueryKey(userKey), updated);
        void queryClient.invalidateQueries({ queryKey: currentSubscriptionQueryKey(userKey), exact: true, refetchType: "active" });
        showToast({ title: selectedCurrentPlan ? "Renewal resumed." : `${selected.billingPeriod === "month" ? "Monthly" : "Weekly"} plan scheduled for your next renewal.`, duration: 2_500 });
        if (mode === "standard") closeStandard();
        else setPage("referral");
        return;
      }
      const checkoutSession = await createCheckout(selected.productId, Crypto.randomUUID());
      const result = await WebBrowser.openAuthSessionAsync(checkoutSession.url, CHECKOUT_SUCCESS_URL);
      if (result.type === "cancel" || result.type === "dismiss") {
        setCheckoutState("idle");
        return;
      }
      const callback = result.type === "success" ? checkoutCallbackFromUrl(result.url) : undefined;
      if (callback !== "success") {
        setCheckoutState("idle");
        setMessage("Checkout was not completed. You can safely try again.");
        return;
      }
      if (completeCheckoutReturn(queryClient, userKey)) {
        setMessage(undefined);
        setSparkCostsOpen(false);
        if (mode === "onboarding") {
          useUiStore.getState().consumeOnboardingReferralEntry();
          setPage("referral");
        }
      }
      setCheckoutState("idle");
    } catch (error) {
      setCheckoutState("idle");
      setMessage(renewalAction ? selectedCurrentPlan ? "Renewal could not be resumed. Please try again." : "The plan change could not be scheduled. Please try again." : checkoutErrorMessage(error));
    } finally {
      checkoutInFlight.current = false;
    }
  }

  async function finish() {
    if (completing) return;
    if (mode === "standard") {
      closeStandard();
      return;
    }
    setCompleting(true);
    setCompletionError(undefined);
    try {
      await onComplete?.();
    } catch (error) {
      setCompletionError(error instanceof Error ? error.message : "Onboarding could not be completed. Please try again.");
      setCompleting(false);
    }
  }

  function dismiss() {
    if (mode === "standard") closeStandard();
    else if (page === "plans") setPage("referral");
    else void finish();
  }

  async function shareReferral() {
    const code = referral.data?.code.code;
    if (!code || sharing) return;
    setSharing(true);
    setMessage(undefined);
    try {
      await NativeShare.share({ message: code }, { dialogTitle: "Share referral" });
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The share sheet could not be opened.");
    } finally {
      setSharing(false);
    }
  }

  const footer = page === "plans" ? <><Button disabled={!selected || checkoutState === "opening" || selectedCurrentPlan && (!renewalAction || !subscription?.cancelAtPeriodEnd)} onPress={() => void checkout()} pressFeedback="none" size="md" variant="primary">{selectedCurrentPlan ? subscription?.cancelAtPeriodEnd && renewalAction ? "Resume renewal" : "Current plan" : renewalAction ? "Switch at renewal" : "Continue to checkout"}</Button>{mode === "standard" ? <Button onPress={closeStandard} size="md" variant="secondary">Close</Button> : null}</> : <Button disabled={!referral.data || sharing} onPress={() => void shareReferral()} size="md" variant="primary">Share</Button>;

  if (mode === "onboarding" && page === "referral") return <OnboardingStepLayout
    action={<><Button disabled={!referral.data || sharing || completing} onPress={() => void shareReferral()} size="md" variant="primary">Share</Button><Button disabled={completing} onPress={() => void finish()} size="md" variant="secondary">Skip</Button>{completionError ? <Button loading={completing} onPress={() => void finish()} size="md" variant="secondary">Retry</Button> : null}</>}
    closeDisabled={completing}
    closeLabel="Close referral"
    description="Invite a friend with your code and earn Sparks as they get started."
    icon={<ReferralIcon size="lg" />}
    onClose={() => void finish()}
    title="Invite a friend"
  >
    <View style={styles.rewardSteps}><Text style={styles.rewardStep}>50 Sparks when your friend signs up, plus 100 more when they start their first subscription.</Text></View>
    {referral.isLoading ? <Text style={styles.heroCopy}>Loading your referral code...</Text> : referral.isError ? <Button onPress={() => void referral.refetch()} size="md" variant="secondary">Retry</Button> : referral.data ? <View style={styles.codeBlock}><Text style={styles.sectionLabel}>YOUR CODE</Text><Text selectable style={styles.code}>{referral.data.code.code}</Text></View> : null}
  </OnboardingStepLayout>;

  const content = page === "plans" ? <ScrollView contentContainerStyle={[styles.content, mode === "onboarding" && styles.onboardingContent]} showsVerticalScrollIndicator={false}>
    {mode === "onboarding" ? <View style={styles.hero}><View style={styles.heroTitleRow}><Text style={styles.heroTitle}>One balance for everything you create and use</Text><ButtonSizeProvider overrideParent size="sm"><Button accessibilityLabel="How Sparks are billed" contentMode="raw" iconOnly onPress={() => setSparkCostsOpen(true)} size="sm" variant="icon"><HelpIcon size="sm" /></Button></ButtonSizeProvider></View><Text style={styles.heroCopy}>Sparks give you a simple way to use AI capabilities, store your work, and keep services connected across Vorinthex.</Text></View> : <View style={styles.balanceHero}><View style={styles.balanceHeading}><SparksIcon size="lg" /><Text accessibilityLabel={balance === undefined ? "Sparks balance unavailable. Showing 0 Sparks" : `${balance} Sparks`} style={styles.balance}>{formatWholeSparks(balance ?? 0)} <Text style={styles.balanceUnit}>Sparks</Text></Text></View><ButtonSizeProvider overrideParent size="sm"><Button accessibilityLabel="How Sparks are billed" contentMode="raw" iconOnly onPress={() => setSparkCostsOpen(true)} size="sm" variant="icon"><HelpIcon size="sm" /></Button></ButtonSizeProvider></View>}
    {mode === "standard" ? <><Tabs accessibilityLabel="Spark offers" accessibilityRole="tablist" onValueChange={(value) => setOfferTab(value as OfferTab)} style={styles.offerTabs} value={offerTab}><TabsTrigger style={styles.offerTab} value="plans">Plans</TabsTrigger><TabsTrigger style={styles.offerTab} value="topup">Top-up</TabsTrigger></Tabs><View style={styles.plans}>{offers.map((product) => <PlanCard current={currentSubscriptionProductKey === product.key} endsAt={currentPlanEndDate} key={product.key} onSelect={() => setSelectedKey(product.key)} product={product} selected={effectiveSelectedKey === product.key} />)}</View></> : <View style={styles.plans}>{subscriptions.map((product) => <PlanCard current={currentSubscriptionProductKey === product.key} endsAt={currentPlanEndDate} key={product.key} onSelect={() => setSelectedKey(product.key)} product={product} selected={effectiveSelectedKey === product.key} />)}</View>}
    {!offers.length ? <View style={styles.state}><Text style={styles.heroCopy}>{productsStatus === "loading" ? "Loading offers..." : "Offers are temporarily unavailable."}</Text>{productsStatus !== "loading" ? <Button onPress={() => void refreshProducts()} size="md" variant="secondary">Retry</Button> : null}</View> : null}
  </ScrollView> : <ScrollView contentContainerStyle={styles.referralContent} showsVerticalScrollIndicator={false}>
    <View style={styles.referralHero}><Text style={styles.heroTitle}>Invite a friend</Text><Text style={styles.heroCopy}>Invite a friend with your code and earn Sparks as they get started.</Text></View>
    <View style={styles.rewardSteps}><Text style={styles.sectionLabel}>HOW IT WORKS</Text><Text style={styles.rewardStep}>Earn 50 Sparks when your friend signs up.</Text><Text style={styles.rewardStep}>Earn 100 more when they start their first subscription.</Text></View>
    {referral.isLoading ? <Text style={styles.heroCopy}>Loading your referral code...</Text> : referral.isError ? <Button onPress={() => void referral.refetch()} size="md" variant="secondary">Retry</Button> : referral.data ? <View style={styles.codeBlock}><Text style={styles.sectionLabel}>YOUR CODE</Text><Text selectable style={styles.code}>{referral.data.code.code}</Text></View> : null}
  </ScrollView>;

  if (mode === "onboarding") return <><View style={[styles.onboardingRoot, { paddingBottom: Math.max(insets.bottom, spacing.md), paddingTop: Math.max(insets.top, spacing.md) }]}>
    {page === "plans" ? <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" pointerEvents="none" style={[styles.onboardingBrand, { height: onboardingHeroHeight, top: insets.top, width }]}>
      <View style={styles.onboardingBackdrop}>
        <NeuralBackdrop height={onboardingHeroHeight} width={width} />
        <LinearGradient colors={["rgba(3,5,7,0)", "rgba(3,5,7,0.96)"]} locations={[0.42, 1]} style={StyleSheet.absoluteFill} />
      </View>
      <ChromeIcon glow={0.72} size={176} source={vorinthexMarkSource} />
    </View> : null}
    {delayedClose.visible ? <Animated.View style={[styles.close, { opacity: delayedClose.opacity, top: Math.max(insets.top, spacing.md) }]}><Button accessibilityLabel="Continue without a plan" contentMode="raw" iconOnly onPress={dismiss} size="md" variant="ghost"><CloseIcon size="sm" /></Button></Animated.View> : null}
    {content}
    <View style={styles.onboardingFooter}>{footer}{page === "plans" && !renewalAction ? <Text style={styles.taxNote}>Taxes are calculated at checkout.</Text> : null}</View>
  </View><SparkCostsSheet onOpenChange={setCostDetailsOpen} open={costDetailsOpen} /></>;

  return <><BottomSheet description={page === "referral" ? "Invite friends and earn Sparks." : undefined} dismissible={!completing} footer={<>{footer}{page === "plans" && !renewalAction ? <Text style={styles.taxNote}>Taxes are calculated at checkout.</Text> : null}</>} height="full" onDismissRequest={dismiss} onOpenChange={(next) => { if (!next) dismiss(); }} open={open} pageKey={page} title={page === "plans" ? "Sparks" : "Invite a friend"}>
    {content}
  </BottomSheet><SparkCostsSheet onOpenChange={setCostDetailsOpen} open={costDetailsOpen} /></>;
}

const styles = StyleSheet.create({
  onboardingRoot: { backgroundColor: palette.page, flex: 1, overflow: "hidden", paddingHorizontal: spacing.lg },
  close: { position: "absolute", right: spacing.md, top: spacing.md, zIndex: 2 },
  onboardingBackdrop: { inset: 0, opacity: 0.34, overflow: "hidden", position: "absolute" },
  onboardingBrand: { alignItems: "center", justifyContent: "center", left: 0, overflow: "hidden", position: "absolute" },
  onboardingFooter: { gap: spacing.sm, paddingTop: spacing.sm },
  content: { gap: spacing.md, paddingBottom: spacing.md },
  onboardingContent: { flexGrow: 1, justifyContent: "flex-end", paddingTop: spacing.xl * 2 },
  hero: { gap: spacing.xs, paddingBottom: spacing.md },
  heroTitleRow: { alignItems: "center", flexDirection: "row", justifyContent: "space-between" },
  balanceHero: { alignItems: "center", flexDirection: "row", justifyContent: "space-between", paddingBottom: spacing.sm },
  balanceHeading: { alignItems: "center", flexDirection: "row", gap: spacing.sm },
  balance: { color: palette.text, fontFamily: fonts.medium, fontSize: 32 },
  balanceUnit: { color: palette.silver500, fontSize: 15 },
  eyebrow: { color: palette.silver500, fontFamily: fonts.medium, fontSize: 10, letterSpacing: 2.4 },
  heroTitle: { color: palette.silver50, fontFamily: fonts.medium, fontSize: 28, lineHeight: 33 },
  heroCopy: { color: palette.silver300, fontFamily: fonts.regular, fontSize: 14, lineHeight: 21 },
  offerTabs: { alignSelf: "stretch" },
  offerTab: { flex: 1 },
  plans: { gap: spacing.sm },
  planWrap: { alignSelf: "stretch", maxWidth: "100%", paddingTop: spacing.xs, position: "relative", width: "100%" },
  plan: { alignItems: "center", alignSelf: "stretch", backgroundColor: "transparent", borderColor: palette.hairline, flexDirection: "row", height: "auto", justifyContent: "space-between", maxWidth: "100%", minHeight: 78, overflow: "hidden", paddingHorizontal: spacing.md, paddingVertical: spacing.sm, width: "100%" },
  planSelected: { borderColor: palette.silver50 },
  currentPlanBadge: { backgroundColor: palette.page, borderRadius: 999, borderWidth: 0, paddingHorizontal: spacing.sm, paddingVertical: 3, position: "absolute", right: spacing.md, top: 0 },
  currentPlanBadgeText: { color: palette.silver50, fontFamily: fonts.medium, fontSize: 11 },
  bestValueBadge: { backgroundColor: "#030507", borderRadius: 999, paddingHorizontal: spacing.sm, paddingVertical: 3, position: "absolute", right: spacing.md, top: 0 },
  bestValueBadgeText: { color: palette.chromeWhite, fontFamily: fonts.medium, fontSize: 11 },
  planValue: { flex: 1, gap: 2, minWidth: 0 },
  planName: { color: palette.silver500, fontFamily: fonts.regular, fontSize: 11 },
  planGrant: { color: palette.silver50, fontFamily: fonts.medium, fontSize: 17 },
  priceRow: { alignItems: "baseline", flexDirection: "row", flexShrink: 0, justifyContent: "flex-end", marginLeft: spacing.sm },
  referencePrice: { color: palette.silver500, fontFamily: fonts.regular, fontSize: 15, marginRight: spacing.xs, textDecorationLine: "line-through" },
  price: { color: palette.chromeWhite, fontFamily: fonts.medium, fontSize: 25 },
  period: { color: palette.silver500, fontFamily: fonts.regular, fontSize: 12 },
  sectionLabel: { color: palette.silver500, fontFamily: fonts.medium, fontSize: 10, letterSpacing: 2 },
  taxNote: { color: palette.silver500, fontFamily: fonts.regular, fontSize: 11, lineHeight: 17, textAlign: "center" },
  referralContent: { gap: spacing.lg, paddingBottom: spacing.lg },
  referralHero: { gap: spacing.sm },
  rewardSteps: { alignItems: "center", gap: spacing.sm },
  rewardStep: { color: palette.silver300, fontFamily: fonts.regular, fontSize: 14, lineHeight: 21, maxWidth: 330, textAlign: "center" },
  state: { alignItems: "center", gap: spacing.md },
  codeBlock: { alignItems: "center", gap: spacing.xs },
  code: { color: palette.chromeWhite, fontFamily: fonts.medium, fontSize: 30, letterSpacing: 4 },
});
