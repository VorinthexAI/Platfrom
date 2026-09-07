import { useQuery, useQueryClient } from "@tanstack/react-query";
import { BottomSheet } from "@vorinthex/shared/ui/bottom-sheet";
import { Button } from "@vorinthex/shared/ui/button";
import { CloseIcon, HelpIcon, ReferralIcon } from "@vorinthex/shared/ui/icons-mobile";
import { SubtleButton } from "@vorinthex/shared/ui/subtle-button";
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
import { useDelayedAction } from "@/hooks/use-delayed-action";
import { refreshAuthoritativeBilling } from "@/lib/billing-refresh";
import { CHECKOUT_SUCCESS_URL, checkoutCallbackFromUrl, createCheckoutHandoff } from "@/lib/checkout-client";
import { activeSubscriptionOffers, activeTopup, effectivePriceCents, formatProductPrice, productSparkAmount, type MobileProduct } from "@/lib/product-client";
import { fetchReferralSummary, referralLinks, referralSummaryQueryKey } from "@/lib/referral-client";
import { recordOnboardingEvent } from "@/lib/onboarding-events";
import { useAppsStore } from "@/state/apps";
import { useAuthStore } from "@/state/auth";
import { useUiStore } from "@/state/ui";
import { fonts, palette, spacing } from "@/theme/tokens";

type PaywallMode = "onboarding" | "standard";
type Page = "plans" | "referral";
type CheckoutState = "checkout-error" | "confirming" | "idle" | "opening" | "refresh-error";

const checkoutHandoffExpired = (expiresAt: string) => Date.parse(expiresAt) <= Date.now();

function PlanCard({ onSelect, product, selected }: { onSelect: () => void; product: MobileProduct; selected: boolean }) {
  const period = product.billingPeriod === "month" ? "month" : product.billingPeriod === "week" ? "week" : null;
  const sparkAmount = productSparkAmount(product);
  return <View style={styles.planWrap}>
    <Button accessibilityLabel={`${formatProductPrice(effectivePriceCents(product), product.currency)}${period ? ` per ${period}` : " one time"}, ${sparkAmount} Sparks`} accessibilityState={{ selected }} contentMode="raw" onPress={onSelect} shape="rounded" size="md" style={[styles.plan, selected && styles.planSelected]} variant="outline">
      <View style={styles.planValue}><Text style={styles.planGrant}>{sparkAmount.toLocaleString("en-US")} Sparks</Text><Text style={styles.planName}>{product.billingPeriod === "month" ? "Monthly plan" : product.billingPeriod === "week" ? "Weekly plan" : "One-time top-up"}</Text></View>
      <View style={styles.priceRow}>{product.discountedPriceCents !== null ? <Text accessibilityLabel={`Reference price ${formatProductPrice(product.priceCents, product.currency)}`} style={styles.referencePrice}>{formatProductPrice(product.priceCents, product.currency)}</Text> : null}<Text style={styles.price}>{formatProductPrice(effectivePriceCents(product), product.currency)}</Text>{period ? <Text style={styles.period}>/{period}</Text> : null}</View>
    </Button>
  </View>;
}

export function PaywallSheet({ initialPage = "plans", mode = "standard", onComplete }: { initialPage?: Page; mode?: PaywallMode; onComplete?: () => Promise<void> | void }) {
  const insets = useSafeAreaInsets();
  const { height, width } = useWindowDimensions();
  const onboardingHeroHeight = Math.max(280, height * 0.4);
  const standardOpen = useUiStore((state) => state.paywallOpen);
  const closeStandard = useUiStore((state) => state.closePaywall);
  const open = mode === "onboarding" || standardOpen;
  const products = useAppsStore((state) => state.products);
  const productsStatus = useAppsStore((state) => state.productsStatus);
  const refreshProducts = useAppsStore((state) => state.refreshProducts);
  const userKey = useAuthStore((state) => state.user?.key);
  const queryClient = useQueryClient();
  const subscriptions = activeSubscriptionOffers(products);
  const topup = activeTopup(products);
  const offers = mode === "standard" && topup ? [...subscriptions, topup] : subscriptions;
  const [page, setPage] = useState<Page>(initialPage);
  const [sparkCostsOpen, setSparkCostsOpen] = useState(false);
  const [selectedKey, setSelectedKey] = useState<string>();
  const [checkoutState, setCheckoutState] = useState<CheckoutState>("idle");
  const [message, setMessage] = useState<string>();
  const [completionError, setCompletionError] = useState<string>();
  const [sharing, setSharing] = useState(false);
  const [completing, setCompleting] = useState(false);
  const recordedOnboardingPages = useRef(new Set<Page>());
  const delayedClose = useDelayedAction(mode === "onboarding" && open && page === "plans", page);
  const preferred = offers.find(({ productId }) => productId === "nova.monthly.discounted") ?? offers[0];
  const effectiveSelectedKey = offers.some(({ key }) => key === selectedKey) ? selectedKey : preferred?.key;
  const selected = offers.find(({ key }) => key === effectiveSelectedKey);
  const referral = useQuery({ queryKey: referralSummaryQueryKey(userKey ?? "unauthenticated"), queryFn: fetchReferralSummary, enabled: Boolean(userKey), refetchOnMount: "always" });

  useEffect(() => {
    if (!open) return;
    const reset = setTimeout(() => {
      setPage(initialPage);
      setSparkCostsOpen(false);
      setCheckoutState("idle");
      setMessage(undefined);
      setCompletionError(undefined);
    }, 0);
    return () => clearTimeout(reset);
  }, [initialPage, open]);

  useEffect(() => {
    if (mode !== "onboarding" || !open) return;
    if (recordedOnboardingPages.current.has(page)) return;
    recordedOnboardingPages.current.add(page);
    void recordOnboardingEvent(page === "plans" ? "onboarding.paywall" : "onboarding.referral").catch(() => undefined);
  }, [mode, open, page]);

  async function refreshBilling() {
    if (!userKey) throw new Error("Your authenticated billing context is unavailable.");
    await refreshAuthoritativeBilling(queryClient, userKey);
  }

  async function refreshReturnedCheckout() {
    setCheckoutState("confirming");
    setMessage("Checkout returned. Billing updates are confirmed by webhook and may take a moment.");
    try {
      await refreshBilling();
      if (mode === "onboarding") {
        setPage("referral");
        setCheckoutState("idle");
      } else closeStandard();
    } catch {
      setCheckoutState("refresh-error");
      setMessage("Checkout returned, but billing status could not be refreshed. Webhook confirmation may still be processing.");
      if (mode === "onboarding") setPage("referral");
    }
  }

  async function checkout() {
    if (!selected || checkoutState === "opening" || checkoutState === "confirming") return;
    setCheckoutState("opening");
    setMessage(undefined);
    try {
      const handoff = await createCheckoutHandoff(selected.productId, Crypto.randomUUID());
      if (checkoutHandoffExpired(handoff.expiresAt)) throw new Error("The checkout link expired before it could open.");
      const result = await WebBrowser.openAuthSessionAsync(handoff.url, CHECKOUT_SUCCESS_URL);
      if (result.type === "cancel" || result.type === "dismiss") {
        setCheckoutState("idle");
        return;
      }
      const callback = result.type === "success" ? checkoutCallbackFromUrl(result.url) : undefined;
      if (callback !== "success") {
        setCheckoutState("checkout-error");
        setMessage("Checkout was not completed. You can safely try again.");
        return;
      }
      await refreshReturnedCheckout();
    } catch (error) {
      setCheckoutState("checkout-error");
      setMessage(error instanceof Error ? error.message : "Checkout could not be opened. Please try again.");
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
      const links = referralLinks(code);
      await NativeShare.share({ title: "Share Vorinthex", message: `Join me on Vorinthex with referral code ${code}: ${links.universal}`, url: links.universal }, { dialogTitle: "Share referral" });
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The share sheet could not be opened.");
    } finally {
      setSharing(false);
    }
  }

  const footer = page === "plans" ? <><Button disabled={!selected} loading={checkoutState === "opening" || checkoutState === "confirming"} onPress={() => void (checkoutState === "refresh-error" ? refreshReturnedCheckout() : checkout())} size="md" variant="primary">{checkoutState === "confirming" ? "Refreshing billing" : checkoutState === "refresh-error" ? "Refresh billing status" : checkoutState === "checkout-error" ? "Try checkout again" : "Continue to checkout"}</Button>{mode === "standard" ? <Button onPress={closeStandard} size="md" variant="secondary">Close</Button> : null}</> : <Button disabled={!referral.data || sharing} onPress={() => void shareReferral()} size="md" variant="primary">Share</Button>;

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
    {referral.isLoading ? <Text style={styles.heroCopy}>Loading your referral code...</Text> : referral.isError ? <View style={styles.state}><Text accessibilityRole="alert" style={styles.error}>Your referral code could not be loaded.</Text><Button onPress={() => void referral.refetch()} size="md" variant="secondary">Retry</Button></View> : referral.data ? <View style={styles.codeBlock}><Text style={styles.sectionLabel}>YOUR CODE</Text><Text selectable style={styles.code}>{referral.data.code.code}</Text></View> : null}
    {message ? <Text accessibilityLiveRegion="polite" style={styles.error}>{message}</Text> : null}
    {completionError ? <Text accessibilityRole="alert" style={styles.error}>{completionError}</Text> : null}
  </OnboardingStepLayout>;

  const content = page === "plans" ? <ScrollView contentContainerStyle={[styles.content, mode === "onboarding" && styles.onboardingContent]} showsVerticalScrollIndicator={false}>
    <View style={styles.hero}><View style={styles.heroTitleRow}><Text style={styles.heroTitle}>One balance for everything you create and use</Text><Button accessibilityLabel="How Sparks are billed" contentMode="raw" iconOnly onPress={() => setSparkCostsOpen(true)} size="md" variant="ghost"><HelpIcon size="sm" variant="muted" /></Button></View><Text style={styles.heroCopy}>Sparks give you a simple way to use AI capabilities, store your work, and keep services connected across Vorinthex.</Text></View>
    {mode === "standard" ? <><Text style={styles.sectionLabel}>PLANS</Text><View style={styles.plans}>{subscriptions.map((product) => <PlanCard key={product.key} onSelect={() => setSelectedKey(product.key)} product={product} selected={effectiveSelectedKey === product.key} />)}</View>{topup ? <><Text style={styles.sectionLabel}>TOP-UP</Text><PlanCard onSelect={() => setSelectedKey(topup.key)} product={topup} selected={effectiveSelectedKey === topup.key} /></> : null}</> : <View style={styles.plans}>{subscriptions.map((product) => <PlanCard key={product.key} onSelect={() => setSelectedKey(product.key)} product={product} selected={effectiveSelectedKey === product.key} />)}</View>}
    {!offers.length ? <View style={styles.state}><Text style={styles.error}>{productsStatus === "loading" ? "Loading offers..." : "Offers are temporarily unavailable."}</Text>{productsStatus !== "loading" ? <Button onPress={() => void refreshProducts()} size="md" variant="secondary">Retry</Button> : null}</View> : null}
    {mode === "standard" ? <SubtleButton onPress={() => setPage("referral")} size="md">Share a referral</SubtleButton> : null}
    {message ? <Text accessibilityLiveRegion="polite" style={styles.error}>{message}</Text> : null}
    {completionError ? <Text accessibilityRole="alert" style={styles.error}>{completionError}</Text> : null}
  </ScrollView> : <ScrollView contentContainerStyle={styles.referralContent} showsVerticalScrollIndicator={false}>
    <View style={styles.referralHero}><Text style={styles.heroTitle}>Invite a friend</Text><Text style={styles.heroCopy}>Invite a friend with your code and earn Sparks as they get started.</Text></View>
    <View style={styles.rewardSteps}><Text style={styles.sectionLabel}>HOW IT WORKS</Text><Text style={styles.rewardStep}>Earn 50 Sparks when your friend signs up.</Text><Text style={styles.rewardStep}>Earn 100 more when they start their first subscription.</Text></View>
    {referral.isLoading ? <Text style={styles.heroCopy}>Loading your referral code...</Text> : referral.isError ? <View style={styles.state}><Text accessibilityRole="alert" style={styles.error}>Your referral code could not be loaded.</Text><Button onPress={() => void referral.refetch()} size="md" variant="secondary">Retry</Button></View> : referral.data ? <View style={styles.codeBlock}><Text style={styles.sectionLabel}>YOUR CODE</Text><Text selectable style={styles.code}>{referral.data.code.code}</Text></View> : null}
    {message ? <Text accessibilityLiveRegion="polite" style={styles.error}>{message}</Text> : null}
    {completionError ? <Text accessibilityRole="alert" style={styles.error}>{completionError}</Text> : null}
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
    <View style={styles.onboardingFooter}>{footer}{page === "plans" ? <Text style={styles.taxNote}>Taxes are calculated at checkout.</Text> : null}</View>
  </View><SparkCostsSheet onOpenChange={setSparkCostsOpen} open={sparkCostsOpen} /></>;

  return <><BottomSheet description={page === "plans" ? "Choose a plan or add Sparks with a one-time top-up." : "Invite friends and earn Sparks."} dismissible={!completing} footer={<>{footer}{page === "plans" ? <Text style={styles.taxNote}>Taxes are calculated at checkout.</Text> : null}</>} height="full" onDismissRequest={dismiss} onOpenChange={(next) => { if (!next) dismiss(); }} open={open} pageKey={page} title={page === "plans" ? "Offers" : "Invite a friend"}>
    <View pointerEvents="none" style={styles.markBackdrop}><ChromeIcon glow={0.18} size={250} source={vorinthexMarkSource} /></View>
    {content}
  </BottomSheet><SparkCostsSheet onOpenChange={setSparkCostsOpen} open={sparkCostsOpen} /></>;
}

const styles = StyleSheet.create({
  markBackdrop: { alignItems: "center", opacity: 0.08, position: "absolute", right: -70, top: 90 },
  onboardingRoot: { backgroundColor: palette.page, flex: 1, overflow: "hidden", paddingHorizontal: spacing.lg },
  close: { position: "absolute", right: spacing.md, top: spacing.md, zIndex: 2 },
  onboardingBackdrop: { inset: 0, opacity: 0.34, overflow: "hidden", position: "absolute" },
  onboardingBrand: { alignItems: "center", justifyContent: "center", left: 0, overflow: "hidden", position: "absolute" },
  onboardingFooter: { gap: spacing.sm, paddingTop: spacing.sm },
  content: { gap: spacing.md, paddingBottom: spacing.md },
  onboardingContent: { flexGrow: 1, justifyContent: "flex-end", paddingTop: spacing.xl * 2 },
  hero: { gap: spacing.xs, paddingBottom: spacing.md },
  heroTitleRow: { alignItems: "center", flexDirection: "row", justifyContent: "space-between" },
  eyebrow: { color: palette.silver500, fontFamily: fonts.medium, fontSize: 10, letterSpacing: 2.4 },
  heroTitle: { color: palette.silver50, fontFamily: fonts.medium, fontSize: 28, lineHeight: 33 },
  heroCopy: { color: palette.silver300, fontFamily: fonts.regular, fontSize: 14, lineHeight: 21 },
  plans: { gap: spacing.sm },
  planWrap: { alignSelf: "stretch", maxWidth: "100%", position: "relative", width: "100%" },
  plan: { alignItems: "center", alignSelf: "stretch", backgroundColor: "transparent", borderColor: palette.hairline, flexDirection: "row", height: "auto", justifyContent: "space-between", maxWidth: "100%", minHeight: 78, overflow: "hidden", paddingHorizontal: spacing.md, paddingVertical: spacing.sm, width: "100%" },
  planSelected: { backgroundColor: "transparent", borderColor: palette.chromeWhite },
  planValue: { flex: 1, gap: 2, minWidth: 0 },
  planName: { color: palette.silver500, fontFamily: fonts.regular, fontSize: 11 },
  planGrant: { color: palette.silver50, fontFamily: fonts.medium, fontSize: 17 },
  priceRow: { alignItems: "baseline", flexDirection: "row", flexShrink: 0, justifyContent: "flex-end", marginLeft: spacing.sm },
  referencePrice: { color: palette.silver500, fontFamily: fonts.regular, fontSize: 15, marginRight: spacing.xs, textDecorationLine: "line-through" },
  price: { color: palette.chromeWhite, fontFamily: fonts.medium, fontSize: 25 },
  period: { color: palette.silver500, fontFamily: fonts.regular, fontSize: 12 },
  error: { color: palette.danger, fontFamily: fonts.regular, fontSize: 13, lineHeight: 19, textAlign: "center" },
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
