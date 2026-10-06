import { useQuery, useQueryClient } from "@tanstack/react-query";
import { BottomSheet } from "@vorinthex/shared/ui/bottom-sheet";
import { Badge } from "@vorinthex/shared/ui/badge";
import { Button } from "@vorinthex/shared/ui/button";
import { CloseIcon, ReferralIcon, SparksIcon } from "@vorinthex/shared/ui/icons-mobile";
import { Tabs, TabsTrigger } from "@vorinthex/shared/ui/tabs";
import { useSessionToast as useToast } from "@/hooks/use-session-toast";
import { LinearGradient } from "expo-linear-gradient";
import { useEffect, useRef, useState } from "react";
import { Animated, ScrollView, Share as NativeShare, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { ChromeIcon } from "@/components/ChromeIcon";
import { NeuralBackdrop } from "@/components/NeuralBackdrop";
import { OnboardingStepLayout } from "@/components/onboarding/OnboardingStepLayout";

import { vorinthexMarkSource } from "@/data/capability-icons";
import { useCurrentSubscription, useWholeSparkBalance } from "@/hooks/use-billing-summary";
import { useDelayedAction } from "@/hooks/use-delayed-action";
import { formatWholeSparks } from "@/lib/billing-client";
import { refreshAuthoritativeBilling } from "@/lib/billing-refresh";
import { useErrorFeedback } from "@/hooks/use-error-feedback";
import { availablePackages, packageForProduct, purchasePackage, purchasesAvailable, restorePurchases } from "@/lib/native-purchases";
import { activeSubscriptionOffers, activeTopup, formatProductPrice, productSparkAmount, type MobileProduct } from "@/lib/product-client";
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

function PlanCard({ current, onSelect, product, selected, storePrice }: { current: boolean; onSelect: () => void; product: MobileProduct; selected: boolean; storePrice: string }) {
  const period = product.billingPeriod === "month" ? "month" : product.billingPeriod === "week" ? "week" : null;
  const sparkAmount = productSparkAmount(product);
  const bestValue = product.billingPeriod === "month";
  const status = current ? "Current plan" : undefined;
  return <View style={styles.planWrap}>
    <Button accessibilityLabel={`${storePrice}${period ? ` per ${period}` : " one time"}, ${sparkAmount} Sparks${status ? `, ${status}` : ""}`} accessibilityState={{ selected }} contentMode="raw" onPress={onSelect} shape="rounded" size="md" style={[styles.plan, selected && styles.planSelected]} variant="outline">
      <View style={styles.planValue}><Text style={styles.planGrant}>{sparkAmount.toLocaleString("en-US")} Sparks</Text><Text style={styles.planName}>{product.billingPeriod === "month" ? "Monthly plan" : product.billingPeriod === "week" ? "Weekly plan" : "One-time top-up"}</Text></View>
      <View style={styles.priceRow}><Text style={styles.price}>{storePrice}</Text>{period ? <Text style={styles.period}>/{period}</Text> : null}</View>
    </Button>
    {status ? <Badge accessibilityElementsHidden importantForAccessibility="no-hide-descendants" pointerEvents="none" style={styles.currentPlanBadge}><Text style={styles.currentPlanBadgeText}>{status}</Text></Badge> : bestValue ? <Badge accessibilityElementsHidden importantForAccessibility="no-hide-descendants" pointerEvents="none" style={styles.bestValueBadge}><Text style={styles.bestValueBadgeText}>Best value</Text></Badge> : null}
  </View>;
}

export function PaywallSheet({ initialPage = "plans", mode = "standard", onComplete }: { initialPage?: Page; mode?: PaywallMode; onComplete?: () => Promise<void> | void }) {
  const insets = useSafeAreaInsets();
  const { height, width } = useWindowDimensions();
  const onboardingHeroHeight = Math.max(280, height * 0.4);
  const standardOpen = useUiStore((state) => state.paywallOpen);
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
  const [selectedKey, setSelectedKey] = useState<string>();
  const [checkoutState, setCheckoutState] = useState<CheckoutState>("idle");
  const checkoutInFlight = useRef(false);
  const [message, setMessage] = useState<string>();
  const [completionError, setCompletionError] = useState<string>();
  const [sharing, setSharing] = useState(false);
  const [completing, setCompleting] = useState(false);

  const recordedOnboardingPages = useRef(new Set<Page>());
  const delayedClose = useDelayedAction(mode === "onboarding" && open && page === "plans", page);
  const preferred = offers.find(({ productId }) => productId === "nova.monthly") ?? offers[0];
  const effectiveSelectedKey = offers.some(({ key }) => key === selectedKey) ? selectedKey : preferred?.key;
  const selected = offers.find(({ key }) => key === effectiveSelectedKey);
  const subscription = subscriptionQuery.data;
  const currentSubscriptionProductKey = subscription && ["active", "trialing", "past_due"].includes(subscription.status) ? subscription.productKey : undefined;
  const selectedCurrentPlan = Boolean(selected && selected.key === currentSubscriptionProductKey);
  const offerings = useQuery({ queryKey: ["store-offerings", userKey], queryFn: () => availablePackages(userKey!), enabled: Boolean(open && userKey && purchasesAvailable()), staleTime: 60_000 });
  const selectedPackage = selected ? packageForProduct(offerings.data ?? [], selected.productId) : undefined;
  const referral = useQuery({ queryKey: referralSummaryQueryKey(userKey ?? "unauthenticated"), queryFn: fetchReferralSummary, enabled: Boolean(userKey && open && (mode === "onboarding" || page === "referral")), initialData: authReferralSummary?.code.ownerUserKey === userKey ? authReferralSummary : undefined });
  useErrorFeedback(open ? [message, completionError, page === "referral" ? referral.error : undefined] : []);

  useEffect(() => {
    if (!open) return;
    const reset = setTimeout(() => {
      setPage(initialPage);
      setOfferTab("plans");
      setCheckoutState("idle");
      setMessage(undefined);
      setCompletionError(undefined);
    }, 0);
    return () => clearTimeout(reset);
  }, [initialPage, mode, open]);

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
    if (!selectedPackage || selectedCurrentPlan) return;
    checkoutInFlight.current = true;
    setCheckoutState("opening");
    setMessage(undefined);
    try {
      await purchasePackage(userKey, selectedPackage);
      if (userKey) {
        void refreshAuthoritativeBilling(queryClient, userKey);
        setMessage(undefined);
        if (mode === "onboarding") {
          useUiStore.getState().consumeOnboardingReferralEntry();
          setPage("referral");
        }
      }
      setCheckoutState("idle");
    } catch (error) {
      setCheckoutState("idle");
      if (!(error && typeof error === "object" && "userCancelled" in error && error.userCancelled)) setMessage("The purchase could not be completed. Please try again.");
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

  const footer = page === "plans" ? <><Button disabled={!selectedPackage || checkoutState === "opening" || selectedCurrentPlan} onPress={() => void checkout()} pressFeedback="none" size="md" variant="primary">{selectedCurrentPlan ? "Current plan" : "Purchase in app"}</Button>{mode === "standard" ? <Button disabled={!purchasesAvailable()} onPress={() => { if (userKey) void restorePurchases(userKey).then(() => { void refreshAuthoritativeBilling(queryClient, userKey); showToast({ title: "Purchases restored", duration: 2_500 }); }).catch(() => setMessage("Purchases could not be restored.")); }} size="md" variant="secondary">Restore purchases</Button> : null}{mode === "standard" ? <Button onPress={closeStandard} size="md" variant="secondary">Close</Button> : null}</> : <Button disabled={!referral.data || sharing} onPress={() => void shareReferral()} size="md" variant="primary">Share</Button>;

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

  const renderPlanCard = (product: MobileProduct) => <PlanCard current={currentSubscriptionProductKey === product.key} key={product.key} onSelect={() => setSelectedKey(product.key)} product={product} selected={effectiveSelectedKey === product.key} storePrice={packageForProduct(offerings.data ?? [], product.productId)?.product.priceString ?? formatProductPrice(product.priceCents, product.currency)} />;
  const content = page === "plans" ? <ScrollView contentContainerStyle={[styles.content, mode === "onboarding" && styles.onboardingContent]} showsVerticalScrollIndicator={false}>
    {mode === "onboarding" ? <View style={styles.hero}><View style={styles.heroTitleRow}><Text style={styles.heroTitle}>One balance for everything you create and use</Text></View><Text style={styles.heroCopy}>Sparks give you a simple way to use AI capabilities, store your work, and keep services connected across Vorinthex.</Text></View> : <View style={styles.balanceHero}><View style={styles.balanceHeading}><SparksIcon size="lg" /><Text accessibilityLabel={balance === undefined ? "Sparks balance unavailable. Showing 0 Sparks" : `${balance} Sparks`} style={styles.balance}>{formatWholeSparks(balance ?? 0)} <Text style={styles.balanceUnit}>Sparks</Text></Text></View></View>}
    {mode === "standard" ? <><Tabs accessibilityLabel="Spark offers" accessibilityRole="tablist" onValueChange={(value) => setOfferTab(value as OfferTab)} style={styles.offerTabs} value={offerTab}><TabsTrigger style={styles.offerTab} value="plans">Plans</TabsTrigger><TabsTrigger style={styles.offerTab} value="topup">Top-up</TabsTrigger></Tabs><View style={styles.plans}>{offers.map(renderPlanCard)}</View></> : <View style={styles.plans}>{subscriptions.map(renderPlanCard)}</View>}
    {!offers.length ? <View style={styles.state}><Text style={styles.heroCopy}>{productsStatus === "loading" ? "Loading offers..." : "Offers are temporarily unavailable."}</Text>{productsStatus !== "loading" ? <Button onPress={() => { void refreshProducts(); if (purchasesAvailable()) void offerings.refetch(); }} size="md" variant="secondary">Retry</Button> : null}</View> : null}
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
    <View style={styles.onboardingFooter}>{footer}</View>
  </View></>;

  return <><BottomSheet description={page === "referral" ? "Invite friends and earn Sparks." : undefined} dismissible={!completing} footer={footer} height="full" onDismissRequest={dismiss} onOpenChange={(next) => { if (!next) dismiss(); }} open={open} pageKey={page} title={page === "plans" ? "Sparks" : "Invite a friend"}>
    {content}
  </BottomSheet></>;
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
  price: { color: palette.chromeWhite, fontFamily: fonts.medium, fontSize: 25 },
  period: { color: palette.silver500, fontFamily: fonts.regular, fontSize: 12 },
  sectionLabel: { color: palette.silver500, fontFamily: fonts.medium, fontSize: 10, letterSpacing: 2 },
  referralContent: { gap: spacing.lg, paddingBottom: spacing.lg },
  referralHero: { gap: spacing.sm },
  rewardSteps: { alignItems: "center", gap: spacing.sm },
  rewardStep: { color: palette.silver300, fontFamily: fonts.regular, fontSize: 14, lineHeight: 21, maxWidth: 330, textAlign: "center" },
  state: { alignItems: "center", gap: spacing.md },
  codeBlock: { alignItems: "center", gap: spacing.xs },
  code: { color: palette.chromeWhite, fontFamily: fonts.medium, fontSize: 30, letterSpacing: 4 },
});
