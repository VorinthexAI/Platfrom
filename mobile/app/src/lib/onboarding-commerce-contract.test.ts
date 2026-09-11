import { expect, test } from "bun:test";

const read = (path: string) => Bun.file(new URL(path, import.meta.url)).text();
const [paywall, onboarding, conversation, intro, stages, delayed, checkout, callback, referral, referralRoute, vault, auth, oauth, layout, appConfig, registry, sharedMobile, sharedWeb, sharedPackage, onboardingState, onboardingEvents, authState] = await Promise.all([
  read("../components/PaywallSheet.tsx"),
  read("../app/onboarding.tsx"),
  read("../components/onboarding/OnboardingCoreConversation.tsx"),
  read("../components/onboarding/OnboardingIntroSequence.tsx"),
  read("../components/onboarding/onboarding-stages.ts"),
  read("../hooks/use-delayed-action.ts"),
  read("./checkout-client.ts"),
  read("../app/checkout/[result].tsx"),
  read("./referral-client.ts"),
  read("../app/referral/[code].tsx"),
  read("./pending-referral-vault.ts"),
  read("../app/auth.tsx"),
  read("./oauth.ts"),
  read("../app/_layout.tsx"),
  read("../../app.json"),
  read("../data/registry.ts"),
  read("../../../../shared/packages/ui/components/subtle-button/subtle-button.mobile.tsx"),
  read("../../../../shared/packages/ui/components/subtle-button/subtle-button.web.tsx"),
  read("../../../../shared/package.json"),
  read("./onboarding-state.ts"),
  read("./onboarding-events.ts"),
  read("../state/auth.ts"),
]);
const [reward, stepLayout, bellIcon, galleryIcon, cameraIcon, referralIcon, mobileIcons] = await Promise.all([
  read("../components/onboarding/OnboardingReward.tsx"),
  read("../components/onboarding/OnboardingStepLayout.tsx"),
  read("../../../../shared/packages/ui/icons/bell/bell.mobile.tsx"),
  read("../../../../shared/packages/ui/icons/gallery/gallery.mobile.tsx"),
  read("../../../../shared/packages/ui/icons/camera/camera.web.tsx"),
  read("../../../../shared/packages/ui/icons/referral/referral.mobile.tsx"),
  read("../../../../shared/packages/ui/icons-mobile.ts"),
]);

test("onboarding uses one scripted Core conversation before auth and plans", () => {
  expect(onboarding).toContain('mode="onboarding"');
  expect(onboarding).toContain("consumeOnboardingReferralEntry()");
  expect(onboarding).toContain('initialPage === "referral"');
  expect(onboarding).toContain("<OnboardingCoreConversation");
  expect(onboarding).not.toContain("OnboardingIntroSequence");
  expect(onboarding).not.toContain("OnboardingCoreSandbox");
  expect(onboarding).not.toContain("OnboardingPermissions");
  expect(onboarding).not.toContain("useLocalSearchParams");
  expect(onboarding).toContain("completeOnboarding()");
  expect(onboarding).not.toMatch(/CardStack|OnboardingCard|ProgressDots|haptic/);
  expect(conversation).toContain("your personal AI agent");
  expect(conversation).toContain("always accessible at the bottom of the screen");
  expect(conversation).toContain("1_000 + (index % 3) * 250");
  expect(conversation).toContain('text="Thinking..."');
  expect(conversation.match(/>Explore<\/Button>/g)).toHaveLength(1);
  expect(conversation).toContain('style={styles.title}>Your guide to Vorinthex AI</Text>');
  expect(conversation).not.toContain('style={styles.eyebrow}>CORE</Text>');
  expect(conversation).toContain("<OnboardingAppPreview");
  expect(conversation).toContain('signal: "Signal is your private inbox for connected email and communication from Vorinthex apps and support.');
  expect(conversation).not.toMatch(/Gmail/i);
  expect(intro).toContain("export function OnboardingAppPreview");
  expect(intro).toContain("<NeuralBackdrop");
  expect(intro).toContain("<SheetSeparator");
  expect(intro).toContain("STAGE_REVEAL_MS = 1_000");
  expect(intro).toContain("logoY.value = withTiming(50");
  expect(intro).toContain(">Done</Button>");
  expect(conversation).toContain(">Skip</Button>");
  expect(conversation).toContain("AccessibilityInfo.announceForAccessibility(text)");
  expect(conversation).toContain('if (step.kind === "welcome") return "onboarding.welcome"');
  expect(conversation).toContain('return "onboarding.sign-in"');
  expect(conversation).toContain("That's everything I need. Create your free account.");
  expect(conversation).toContain('variant="primary">Get started</Button>');
  expect(conversation).toContain("void recordOnboardingEvent(event)");
  expect(conversation).not.toMatch(/TextInput|CoreComposer|Pressable|Touchable/);
  expect(stages).toContain('[\n  "vorinthex-ai",\n  "archive",\n  "gallery",\n  "compass",\n  "signal",\n  "ascend",\n  "core",');
  expect(layout).not.toContain("useOnboardingStore");
  expect(registry).not.toContain("onboardingDescription");
  expect(registry).toContain('tagline: "Your private inbox for email\\nand Vorinthex communication."');
  expect(registry).toContain('sectionLabel: "Inbox"');
  expect(onboarding).toContain('onFinished={() => void startAuth()}');
});

test("auth uses an unboxed action layout and includes the AI disclosure", () => {
  expect(auth).not.toContain("<ChromePanel");
  expect(auth).not.toContain("styles.inputLabel");
  expect(auth).toContain("AI-powered features");
  expect(auth).toContain("Vorinthex AI uses artificial intelligence to generate and process text, images, audio and video.");
  expect(auth).toContain('recordAnalyticsEvent(`auth.option.selected.${provider}`)');
  expect(auth).toContain('recordAnalyticsEvent("auth.option.selected.email")');
  for (const provider of ["google", "apple", "email"]) {
    expect(onboardingEvents).toContain(`"auth.option.selected.${provider}"`);
  }
});

test("Core requests permissions conversationally without automatic Gallery imports", () => {
  expect(layout).not.toContain("gallery-onboarding-import");
  expect(onboarding).toContain('<OnboardingReward onFinished={() => setPhase("profile-badge")}');
  expect(onboarding).toContain('<OnboardingProfileBadge onFinished={handleComplete}');
  expect(onboarding).toContain('onComplete={() => setPhase("reward")}');
  expect(reward).toContain('title="Free sparks"');
  expect(reward).toContain("You have been granted 100 Sparks.");
  expect(reward).toContain("<OnboardingStepLayout");
  expect(reward).toContain("<GiftIcon");
  expect(reward).toContain('variant="primary">Next</Button>');
  expect(reward).toContain("onClose={onFinished}");
  expect(reward).not.toContain('>Skip</Button>');
  expect(reward).not.toContain("onboarding.reward.skipped");
  expect(reward).toContain('closeLabel="Close reward introduction"');
  expect(reward).not.toContain("<Canvas");
  expect(reward).not.toMatch(/adjust|grantAccount|setQueryData/);
  expect(conversation).toContain('permission: "photos"');
  expect(conversation).toContain('permission: "camera"');
  expect(conversation).toContain('permission: "notifications"');
  expect(conversation.indexOf('permission: "photos"')).toBeLessThan(conversation.indexOf('permission: "camera"'));
  expect(conversation.indexOf('permission: "camera"')).toBeLessThan(conversation.indexOf('permission: "notifications"'));
  expect(conversation).toContain("ImagePicker.requestMediaLibraryPermissionsAsync");
  expect(conversation).toContain("ImagePicker.requestCameraPermissionsAsync");
  expect(conversation).toContain("Notifications.requestPermissionsAsync");
  expect(conversation).toContain("Allow access to your phone's photo library to start managing your images smartly with Gallery.");
  expect(conversation).toContain("Allow notifications so you never miss anything.");
  expect(conversation).toContain("important connected email, Vorinthex app communication, or support replies arrive");
  expect(conversation).not.toMatch(/up to 50 recent photos|skip screenshots|preparing and organizing your photos/);
  expect(stepLayout.indexOf("styles.header")).toBeLessThan(stepLayout.indexOf("styles.hero"));
  expect(stepLayout).toContain('accessibilityRole="header"');
  expect(stepLayout).toContain('textAlign: "left"');
  expect(paywall).toContain('title="Invite a friend"');
  expect(paywall).toContain("<ReferralIcon");
  expect(stepLayout).not.toContain("useDelayedAction");
  expect(stepLayout).toContain("{onClose ? <View");
  expect(stepLayout).toContain('right: -spacing.xs, top: 0');
  expect(bellIcon).toContain('d="M18 9a6 6 0 0 0-12 0');
  expect(bellIcon).not.toContain('d="M5 12h14"');
  expect(galleryIcon).toContain("<Rect x={3} y={6} width={16} height={15}");
  expect(cameraIcon).toContain('<circle cx="12" cy="13" r="3.25"');
  expect(cameraIcon).not.toContain('d="M5 12h14"');
  expect(referralIcon).toContain("export function ReferralIcon");
  expect(mobileIcons).toContain('export * from "./icons/referral/referral.mobile"');
  for (const source of [conversation, reward, stepLayout, paywall]) {
    for (const button of source.replaceAll("=>", "ARROW").match(/<Button\b[^>]*>/g) ?? []) expect(button).toContain(button.includes('accessibilityLabel="How Sparks are billed"') ? 'size="xs"' : 'size="md"');
  }
  expect(paywall.match(/>Skip<\/Button>/g)).toHaveLength(1);
  expect(appConfig).toContain('"expo-notifications"');
  expect(appConfig).not.toContain('"expo-media-library"');
});

test("only paywall close is delayed and referral data loads only while reachable", () => {
  expect(delayed).toContain("DELAYED_ACTION_MS = 3_000");
  expect(paywall).toContain('enabled: Boolean(userKey && open && (mode === "onboarding" || page === "referral"))');
  expect(paywall).toContain('useDelayedAction(mode === "onboarding" && open && page === "plans", page)');
  expect(paywall).toContain('accessibilityLabel="Continue without a plan"');
  expect(paywall).toContain("top: Math.max(insets.top, spacing.md)");
  expect(paywall).toContain("<CloseIcon");
  expect(stepLayout).not.toContain("useDelayedAction");
  expect(paywall.match(/>Skip<\/Button>/g)).toHaveLength(1);
});

test("checkout uses a strict authenticated handoff and confirms only by refetching server state", () => {
  expect(checkout).toContain('z.strictObject({');
  expect(checkout).toContain('"Idempotency-Key": z.string().uuid().parse(idempotencyKey)');
  expect(checkout).toContain('CHECKOUT_SUCCESS_URL = "vorinthexcore://checkout/success"');
  expect(paywall).toContain('result.type === "cancel" || result.type === "dismiss"');
  expect(paywall).toContain('callback !== "success"');
  expect(paywall).toContain('setCheckoutState("confirming")');
  expect(paywall).toContain("refreshAuthoritativeBilling(queryClient, userKey)");
  expect(callback).toContain("refreshAuthoritativeBilling(queryClient, user.key)");
  expect(callback).toContain("enterOnboardingReferral()");
  expect(callback).not.toContain("onboarding?step");
  expect(callback).not.toContain("Payment received");
  expect(paywall).not.toMatch(/setQueryData|grant|activateSubscription/);
});

test("referral summary, recipient vault, sharing, and auth acquisition stay strict", () => {
  expect(referral).toContain('/^[A-F0-9]{12}$/');
  expect(referral).toContain('params: { includeInvitees: "true" }');
  expect(referral).toContain('apiClient.get("/referrals/summary")');
  expect(referral).toContain("z.strictObject");
  expect(paywall).toContain("NativeShare.share");
  expect(paywall).not.toContain("NativeShare.dismissedAction");
  expect(paywall).not.toMatch(/loading=\{sharing\}/);
  expect(vault).toContain("SecureStore.setItemAsync");
  expect(vault).toContain("referralCodeSchema.safeParse");
  expect(referralRoute).toContain('router.replace("/auth")');
  expect(auth).toContain("referral_code: referralCode");
  expect(oauth.match(/referral_code/g)?.length).toBeGreaterThanOrEqual(3);
  expect(oauth).toContain("clearPendingReferralCode()");
  expect(appConfig).toContain('"pathPrefix": "/referral/"');
});

test("onboarding completion is durable and step analytics use fixed dotted slugs", () => {
  expect(onboarding).toContain("markOnboardingPreviewComplete()");
  expect(onboarding).toContain('router.replace("/auth")');
  expect(onboardingState).toContain('from "expo-secure-store"');
  expect(onboardingState).toContain('setItemAsync(COMPLETE_KEY, "true")');
  expect(onboardingState).not.toContain("setItemAsync(PREVIEW_COMPLETE_KEY");
  expect(authState).toContain("markOnboardingComplete()");
  expect(layout).toContain("localOnboarding.complete");
  expect(onboardingEvents).toContain('"onboarding.vorinthex-ai"');
  expect(onboardingEvents).toContain('"onboarding.welcome"');
  expect(onboardingEvents).toContain('"onboarding.sign-in"');
  expect(onboardingEvents).toContain('"onboarding.gallery"');
  expect(onboardingEvents).toContain('"onboarding.referral"');
  expect(conversation).toContain("recordOnboardingEvent(event)");
  expect(conversation).toContain('addUserMessage("Show me around")');
  expect(conversation).toContain('>Show me around</Button>');
  expect(conversation).toContain('import { RichText } from "@vorinthex/shared/ui/rich-text"');
  expect(conversation).toContain('<RichText content={message.text} />');
  expect(conversation).toContain('onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: false })}');
  expect(conversation).toContain('`onboarding.${permission}.${allowed ? "allowed" : "skipped"}`');
  for (const permission of ["photos", "camera", "notifications"]) {
    expect(onboardingEvents).toContain(`"onboarding.${permission}.allowed"`);
    expect(onboardingEvents).toContain(`"onboarding.${permission}.skipped"`);
  }
  expect(paywall).toContain('page === "plans" ? "onboarding.paywall" : "onboarding.referral"');
});

test("production onboarding completion persists and uses the authenticated profile", () => {
  expect(onboardingState).not.toContain("TEST_ONBOARDING_EVERY_SIGN_IN");
  expect(onboardingState).toContain("clearOnboardingCompletion");
  expect(onboarding).toContain("const completion = completeOnboarding()");
  const completion = onboarding.slice(onboarding.indexOf("const handleComplete"));
  expect(completion.indexOf('requestAgentGreeting("onboarding")')).toBeLessThan(completion.indexOf('router.replace("/capability/archive")'));
  expect(completion.indexOf('router.replace("/capability/archive")')).toBeLessThan(completion.indexOf("void completion.catch"));
  expect(onboarding).toContain('.catch(() => router.replace("/onboarding"))');
  expect(authState.indexOf("set({ user: { ...previousUser, isOnboarded: true } })")).toBeLessThan(authState.indexOf('patchJson<{ isOnboarded: true }, unknown>("/auth/me"'));
  expect(layout).toContain("user?.isOnboarded === true");
});

test("shared subtle actions compose Button", () => {
  expect(sharedMobile).toContain("<Button");
  expect(sharedWeb).toContain("<Button");
  expect(sharedPackage).toContain('"./ui/subtle-button"');
  expect(sharedMobile).not.toMatch(/Pressable|Text\s+onPress/);
});
