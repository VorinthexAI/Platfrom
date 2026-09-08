import { expect, test } from "bun:test";

const read = (path: string) => Bun.file(new URL(path, import.meta.url)).text();
const [paywall, sparkCosts, observer, layout, profile, bottomSheet] = await Promise.all([
  read("../components/PaywallSheet.tsx"),
  read("../components/SparkCostsSheet.tsx"),
  read("../components/SparksBalanceObserver.tsx"),
  read("../app/_layout.tsx"),
  read("../components/AccountScreen.tsx"),
  read("../../../../shared/packages/ui/components/bottom-sheet/bottom-sheet.mobile.tsx"),
]);

test("mounts one catalog-driven shared-control paywall with checkout and referral pages", () => {
  expect(layout.match(/<PaywallSheet \/>/g)).toHaveLength(1);
  expect(paywall).toContain("activeSubscriptionOffers(products)");
  expect(paywall).toContain('productId === "nova.monthly.discounted"');
  expect(paywall).toContain("discountedPriceCents");
  expect(paywall).not.toContain("POPULAR");
  expect(paywall).toContain('variant="primary">{checkoutState');
  expect(paywall).toContain("createCheckoutHandoff(selected.productId, Crypto.randomUUID())");
  expect(paywall).toContain("WebBrowser.openAuthSessionAsync(handoff.url, CHECKOUT_SUCCESS_URL)");
  expect(paywall).toContain("refreshAuthoritativeBilling(queryClient, userKey)");
  expect(paywall).toContain('setPage("referral")');
  expect(paywall).toContain("Invite a friend with your code");
  expect(paywall).toContain("Taxes are calculated at checkout.");
  expect(paywall).toContain("activeTopup(products)");
  expect(paywall).toContain('offerTab === "plans" ? subscriptions : topup ? [topup] : []');
  expect(paywall).toContain("One-time top-up");
  expect(paywall).toContain("Continue to checkout");
  expect(paywall).toContain('title={page === "plans" ? "Sparks"');
  expect(paywall).toContain("useWholeSparkBalance(userKey)");
  expect(paywall).toContain("formatWholeSparks(balance ?? 0)");
  expect(paywall).toContain("Current balance");
  expect(paywall).toContain('from "@vorinthex/shared/ui/tabs"');
  expect(paywall).toContain('<TabsList accessibilityLabel="Spark offers"');
  expect(paywall).toContain('<TabsTrigger style={styles.offerTab} value="plans">');
  expect(paywall).toContain('<TabsTrigger style={styles.offerTab} value="topup">');
  expect(paywall).toContain('>Current plan</Text></Badge>');
  expect(paywall).toContain("selected && styles.planSelected");
  expect(paywall).toContain("planSelected: { backgroundColor: palette.insetHighlight }");
  expect(paywall).toContain("Cancel renewal");
  expect(paywall).toContain("Restore renewal");
  expect(paywall).not.toContain("styles.markBackdrop");
  expect(paywall).toContain('setOfferTab("plans")');
  expect(paywall).toContain("One balance for everything you create and use");
  expect(paywall).toContain("Sparks give you a simple way to use AI capabilities, store your work, and keep services connected across Vorinthex.");
  expect(paywall).not.toMatch(/Choose an offer\.|Choose your plan\.|Usage-based pricing|Pay only for what you use/i);
  expect(paywall).toContain('accessibilityLabel="How Sparks are billed"');
  expect(paywall.match(/variant="icon"><HelpIcon size="sm" \/><\/Button>/g)).toHaveLength(2);
  expect(paywall).toContain("<SparkCostsSheet");
  expect(sparkCosts).toContain("charges.map((charge)");
  expect(sparkCosts).not.toContain("charges.filter(");
  expect(sparkCosts).toContain("Spark per new email");
  expect(sparkCosts).toContain("Sparks per GB-month");
  expect(sparkCosts).toContain('variant="secondary">Close</Button>');
  expect(sparkCosts).not.toContain("Sparks are the shared usage unit across Vorinthex");
  expect(sparkCosts).not.toMatch(/borderColor|borderWidth|borderRadius/);
  expect(paywall).not.toMatch(/Pressable|TouchableOpacity|<button/);
  expect(sparkCosts).not.toMatch(/Pressable|TouchableOpacity|<button/);
});

test("insufficient balance opens the same Sparks shop", () => {
  expect(observer).toContain("subscribeDomainErrors");
  expect(observer).toContain("billingSummaryQueryKey(userKey)");
  expect(observer).toContain("openPaywall()");
  expect(observer).not.toMatch(/Dialog|BottomSheet|openSparksSheet/);
});

test("Profile routes to Settings while account actions remain available", () => {
  expect(profile).toContain('router.push("/settings")');
  expect(profile).toContain('accessibilityLabel="Open notifications"');
  expect(profile).toContain('label="Feedback"');
  expect(profile).toContain('label="Report issue"');
  expect(profile).toContain('label="FAQ"');
  expect(profile).toContain('label="Log out"');
  expect(profile).not.toContain('focusKey="profile-settings"');
  for (const text of ["What are Sparks?", "How do plan grants work?", "Do top-ups expire?", "How do referral rewards work?", "Can I cancel or renew?", "How do I restore renewal?"]) expect(profile).toContain(text);
});

test("all ordinary paywall and profile sheet controls resolve to md", () => {
  expect(paywall).toContain('size="md" variant="primary">Share</Button>');
  expect(bottomSheet).toContain('export type BottomSheetItemProps = Omit<ButtonProps, "size">');
  expect(bottomSheet).toContain('size="md"');
});
