import { expect, test } from "bun:test";

const read = (path: string) => Bun.file(new URL(path, import.meta.url)).text();
const [paywall, onboarding, intro, sandbox, sandboxClient, stages, delayed, checkout, callback, referral, referralRoute, vault, auth, oauth, layout, appConfig, registry, sharedMobile, sharedWeb, sharedPackage, onboardingState, onboardingEvents, authState] = await Promise.all([
  read("../components/PaywallSheet.tsx"),
  read("../app/onboarding.tsx"),
  read("../components/onboarding/OnboardingIntroSequence.tsx"),
  read("../components/onboarding/OnboardingCoreSandbox.tsx"),
  read("./onboarding-sandbox-client.ts"),
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
const [reward, permissions, stepLayout, bellIcon, galleryIcon, cameraIcon, referralIcon, mobileIcons] = await Promise.all([
  read("../components/onboarding/OnboardingReward.tsx"),
  read("../components/onboarding/OnboardingPermissions.tsx"),
  read("../components/onboarding/OnboardingStepLayout.tsx"),
  read("../../../../shared/packages/ui/icons/bell/bell.mobile.tsx"),
  read("../../../../shared/packages/ui/icons/gallery/gallery.mobile.tsx"),
  read("../../../../shared/packages/ui/icons/camera/camera.web.tsx"),
  read("../../../../shared/packages/ui/icons/referral/referral.mobile.tsx"),
  read("../../../../shared/packages/ui/icons-mobile.ts"),
]);

test("onboarding presents the mission and ordered server-registry apps before plans", () => {
  expect(onboarding).toContain('mode="onboarding"');
  expect(onboarding).toContain("consumeOnboardingReferralEntry()");
  expect(onboarding).toContain('initialPage === "referral"');
  expect(onboarding).toContain("<OnboardingIntroSequence");
  expect(onboarding).toContain("<OnboardingCoreSandbox");
  expect(onboarding).toContain('setPhase("sandbox")');
  expect(onboarding).not.toContain("useLocalSearchParams");
  expect(onboarding).toContain("completeOnboarding()");
  expect(onboarding).not.toMatch(/CardStack|OnboardingCard|ProgressDots|haptic/);
  expect(intro).toContain("We’re building connected AI apps that share context, learn together, and make every part of your digital life more intelligent.");
  expect(intro).toContain('"VORINTHEX AI"');
  expect(intro).toContain("useReducedMotion()");
  expect(intro).toContain("transitionLocked.current");
  expect(intro).toContain("for (const app of apps)");
  expect(intro).toContain('Image.prefetch(app.logoUrl, "memory-disk")');
  expect(intro).toContain("LOCAL_APP_LOGOS[stage.app.slug]");
  expect(intro).toContain("if (!mounted || !cached) return");
  expect(intro).toContain("AccessibilityInfo.announceForAccessibility(announcement)");
  expect(intro).toContain("<NeuralBackdrop");
  expect(intro).toContain("height * 0.4");
  expect(intro).toContain("<SheetSeparator");
  expect(intro).toContain("onboarding-sheet-edge");
  expect(intro).toContain("incomingY.value = 120");
  expect(intro).toContain("incomingY.value = withTiming(50");
  expect(intro).toContain("STAGE_REVEAL_MS = 1_000");
  expect(intro).toContain("incomingOpacity.value = 0.3");
  expect(intro).toContain("titleOpacity.value = 0.3");
  expect(intro).toContain("descriptionOpacity.value = 0.3");
  expect(intro.match(/importantForAccessibility="no-hide-descendants"/g)?.length).toBe(3);
  expect(intro).toContain("<ChromeIcon");
  expect(intro).toContain('isFinalStage ? "Try Core" : "Next"');
  expect(intro).toContain('accessibilityRole="progressbar"');
  expect(intro).toContain("progress.value = withTiming((activeIndex + 1) / stages.length");
  expect(intro).not.toContain('disabled={transitioning}');
  expect(intro).not.toMatch(/Pressable|Touchable/);
  expect(stages).toContain('[\n  "archive",\n  "gallery",\n  "compass",\n  "signal",\n  "ascend",\n  "core",');
  expect(intro).toContain("currentStage.app.name");
  expect(intro).toContain("currentStage.app.description");
  expect(layout).not.toContain("useOnboardingStore");
  expect(registry).not.toContain("onboardingDescription");
  expect(sandbox).toContain("Ask 3 questions to continue");
  expect(sandbox).toContain("<RichText");
  expect(sandbox).toContain('text="Thinking..."');
  expect(sandbox).toContain("progress.value = withTiming(answers.length / 3");
  expect(sandbox).toContain(">Get started</Button>");
  expect(sandbox).toContain("prompts.filter");
  expect(sandbox).not.toContain("userMessage");
  expect(sandbox).not.toMatch(/TextInput|CoreComposer|Pressable|Touchable/);
  expect(sandboxClient).toContain('slice(0, 3)');
  expect(sandboxClient).toContain('/onboarding/sandbox/answers');
});

test("auth uses an unboxed action layout and includes the AI disclosure", () => {
  expect(auth).not.toContain("<ChromePanel");
  expect(auth).not.toContain("styles.inputLabel");
  expect(auth).toContain("AI-powered features");
  expect(auth).toContain("Vorinthex AI uses artificial intelligence to generate and process text, images, audio and video.");
});

test("referral leads through reward, notification, Gallery, and camera access", () => {
  expect(onboarding).toContain('<OnboardingReward onFinished={() => setPhase("permissions")}');
  expect(onboarding).toContain("<OnboardingPermissions");
  expect(onboarding).toContain('onComplete={() => setPhase("reward")}');
  expect(reward).toContain('title="Free sparks"');
  expect(reward).toContain("Your first 100 Sparks are ready. Use them anywhere in Vorinthex AI.");
  expect(reward).toContain("<OnboardingStepLayout");
  expect(reward).toContain("<GiftIcon");
  expect(reward).toContain("onClose={onFinished}");
  expect(reward).toContain('variant="secondary">Skip</Button>');
  expect(reward).not.toContain("<Canvas");
  expect(reward).not.toMatch(/adjust|grantAccount|setQueryData/);
  expect(permissions).toContain("BellIcon");
  expect(permissions).toContain("Notifications.requestPermissionsAsync");
  expect(permissions).toContain("GalleryIcon");
  expect(permissions).toContain("ImagePicker.requestMediaLibraryPermissionsAsync");
  expect(permissions).toContain("CameraIcon");
  expect(permissions).toContain("ImagePicker.requestCameraPermissionsAsync");
  expect(permissions).toContain('title: "Allow notifications"');
  expect(permissions).toContain('title: "Allow Gallery"');
  expect(permissions).toContain('title: "Allow camera"');
  expect(permissions).toContain("Stay up to date with updates and never miss anything.");
  expect(permissions).not.toContain("Directory.pickDirectoryAsync()");
  expect(permissions).toContain("Linking.openSettings()");
  expect(permissions).toContain("<OnboardingStepLayout");
  expect(permissions).toContain('disabled={busy} onPress={() => void request()} size="md" variant="primary"');
  expect(permissions).not.toContain("loading={busy}");
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
  for (const source of [intro, sandbox, reward, permissions, stepLayout, paywall]) {
    for (const button of source.replaceAll("=>", "ARROW").match(/<Button\b[^>]*>/g) ?? []) expect(button).toContain('size="md"');
  }
  for (const source of [intro, sandbox, permissions]) expect(source).not.toContain('>Skip</Button>');
  expect(paywall.match(/>Skip<\/Button>/g)).toHaveLength(1);
  expect(appConfig).toContain('"expo-notifications"');
});

test("only paywall close is delayed and referral data starts loading after auth", () => {
  expect(delayed).toContain("DELAYED_ACTION_MS = 3_000");
  expect(paywall).toContain("enabled: Boolean(userKey)");
  expect(paywall).not.toContain('enabled: page === "referral"');
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
  expect(onboardingEvents).toContain('"onboarding.gallery"');
  expect(onboardingEvents).toContain('"onboarding.referral"');
  expect(intro).toContain("recordOnboardingEvent(eventSlug)");
  expect(paywall).toContain('page === "plans" ? "onboarding.paywall" : "onboarding.referral"');
});

test("production onboarding completion persists and uses the authenticated profile", () => {
  expect(onboardingState).not.toContain("TEST_ONBOARDING_EVERY_SIGN_IN");
  expect(onboardingState).toContain("clearOnboardingCompletion");
  expect(onboarding).toContain("const completion = completeOnboarding()");
  expect(onboarding.indexOf('router.replace("/capability/archive")')).toBeLessThan(onboarding.indexOf("void completion.catch"));
  expect(onboarding).toContain('completion.catch(() => router.replace("/onboarding"))');
  expect(authState.indexOf("set({ user: { ...previousUser, isOnboarded: true } })")).toBeLessThan(authState.indexOf('patchJson<{ isOnboarded: true }, unknown>("/auth/me"'));
  expect(layout).toContain("user?.isOnboarded === true");
});

test("shared subtle actions compose Button", () => {
  expect(sharedMobile).toContain("<Button");
  expect(sharedWeb).toContain("<Button");
  expect(sharedPackage).toContain('"./ui/subtle-button"');
  expect(sharedMobile).not.toMatch(/Pressable|Text\s+onPress/);
});
