import { AppleIcon, GoogleIcon, LinkOffIcon, MailIcon } from "@vorinthex/shared/ui/icons-mobile";
import { Button } from "@vorinthex/shared/ui/button";
import { BottomSheet } from "@vorinthex/shared/ui/bottom-sheet";
import { TextInput } from "@vorinthex/shared/ui/text-input";
import { isAxiosError } from "axios";
import * as Linking from "expo-linking";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { AccessibilityInfo, Keyboard, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { vorinthexMarkSource } from "@/data/capability-icons";
import { AuthSplashScreen } from "@/components/AuthSplashScreen";
import { ChromeIcon } from "@/components/ChromeIcon";
import { NeuralBackdrop } from "@/components/NeuralBackdrop";
import { getJson, postJson } from "@/lib/api-client";
import { launchOAuthProvider, type OAuthProvider } from "@/lib/oauth";
import { recordAnalyticsEvent } from "@/lib/onboarding-events";
import { useAuthStore } from "@/state/auth";
import { fonts, palette, spacing, tracking } from "@/theme/tokens";
import { clearPendingReferralCode, readPendingReferralCode } from "@/lib/pending-referral-vault";
import { setPendingTeamMfaChallenge } from "@/lib/team-client";

type LoginResponse = {
  handoff_token_hash?: string;
  expires_at: string;
};

const FRONTEND_URL = (process.env.EXPO_PUBLIC_FRONTEND_URL ?? "https://vorinthex.com").replace(/\/$/, "");

function messageFor(error: unknown) {
  if (isAxiosError<{ error?: string }>(error)) {
    return error.response?.data?.error ?? (error.response ? "Sign in could not be completed." : "Check your connection and try again.");
  }
  return error instanceof Error ? error.message : "Sign in could not be completed.";
}

export default function AuthRoute() {
  const router = useRouter();
  const params = useLocalSearchParams<{ link_error?: string; oauth_error?: string }>();
  const insets = useSafeAreaInsets();
  const { height, width } = useWindowDimensions();
  const hydrate = useAuthStore((state) => state.hydrate);
  const [emailVisible, setEmailVisible] = useState(false);
  const [email, setEmail] = useState("");
  const [submittedEmail, setSubmittedEmail] = useState("");
  const [checkInbox, setCheckInbox] = useState(false);
  const [handoff, setHandoff] = useState<{ token: string; expiresAt: number } | null>(null);
  const [completingSignIn, setCompletingSignIn] = useState(false);
  const requestVersion = useRef(0);
  const requestPending = useRef(false);
  const [loading, setLoading] = useState<OAuthProvider | null>(null);
  const [error, setError] = useState<string | null>(null);
  const busy = loading !== null;
  const emailInvalid = error === "Enter a valid email address.";
  const invalidLinkVisible = params.link_error === "invalid";

  useFocusEffect(useCallback(() => () => {
    requestVersion.current += 1;
    requestPending.current = false;
    setEmailVisible(false);
    setCheckInbox(false);
    setHandoff(null);
    setCompletingSignIn(false);
  }, []));

  useEffect(() => {
    if (!handoff) return;
    let active = true;
    let claiming = false;
    const version = requestVersion.current;
    const poll = async () => {
      if (claiming || version !== requestVersion.current) return;
      let claimAttempted = false;
      if (Date.now() >= handoff.expiresAt) {
        if (active && version === requestVersion.current) {
          setCheckInbox(false);
          setHandoff(null);
          setError("That sign-in link expired. Request a new one.");
        }
        return;
      }
      try {
        const status = await getJson<{ status: string }>(`/auth/handoff/status?handoff=${encodeURIComponent(handoff.token)}`);
        if (!active || version !== requestVersion.current) return;
        if (status.status === "gone") {
          setCheckInbox(false);
          setHandoff(null);
          setError("That sign-in link expired or was already used. Request a new one.");
          return;
        }
        if (status.status !== "approved" || claiming) return;
        claiming = true;
        claimAttempted = true;
        setCompletingSignIn(true);
        const claim = await postJson<{ handoff_token_hash: string }, { status: string; totp_challenge_token_hash?: string }>(
          "/auth/handoff/claim",
          { handoff_token_hash: handoff.token },
        );
        if (!active || version !== requestVersion.current) return;
        if (claim.status === "authenticated") {
          await hydrate({ newSession: true });
          if (!active || version !== requestVersion.current) return;
          claiming = false;
        } else {
          claiming = false;
          if ((claim.status === "totp_setup_required" || claim.status === "totp_required") && claim.totp_challenge_token_hash) {
            setPendingTeamMfaChallenge(claim.status === "totp_required" ? "totp_required" : "setup_required", claim.totp_challenge_token_hash);
            router.replace("/auth/mfa");
          } else {
            setCompletingSignIn(false);
            setCheckInbox(false);
            setHandoff(null);
            setError("This account requires an additional verification step.");
          }
        }
      } catch (pollError) {
        claiming = false;
        if (isAxiosError(pollError) && !pollError.response && !claimAttempted) return;
        if (active && version === requestVersion.current) {
          setCompletingSignIn(false);
          setCheckInbox(false);
          setHandoff(null);
          setError(messageFor(pollError));
        }
      }
    };
    void poll();
    const interval = setInterval(() => void poll(), 2_000);
    return () => {
      active = false;
      clearInterval(interval);
    };
  }, [handoff, hydrate, router]);

  useEffect(() => {
    if (error && Platform.OS === "ios") AccessibilityInfo.announceForAccessibility(error);
  }, [error]);

  const oauth = async (provider: OAuthProvider) => {
    void recordAnalyticsEvent(`auth.option.selected.${provider}`).catch(() => undefined);
    if (params.oauth_error) router.setParams({ oauth_error: undefined });
    setError(null);
    setLoading(provider);
    try {
      if (await launchOAuthProvider(provider)) {
        await hydrate({ newSession: true });
      }
    } catch (oauthError) {
      setError(messageFor(oauthError));
    } finally {
      setLoading(null);
    }
  };

  const selectEmail = () => {
    void recordAnalyticsEvent("auth.option.selected.email").catch(() => undefined);
    if (params.oauth_error) router.setParams({ oauth_error: undefined });
    setError(null);
    setEmailVisible(true);
  };

  const closeEmail = () => {
    requestVersion.current += 1;
    requestPending.current = false;
    setEmailVisible(false);
    setCheckInbox(false);
    setCompletingSignIn(false);
    setHandoff(null);
    setError(null);
    Keyboard.dismiss();
  };

  const submitEmail = async () => {
    if (requestPending.current) return;
    const normalized = email.trim().toLowerCase();
    if (!/^\S+@\S+\.\S+$/.test(normalized)) {
      setError("Enter a valid email address.");
      return;
    }
    requestPending.current = true;
    const version = ++requestVersion.current;
    setError(null);
    setSubmittedEmail(normalized);
    setCheckInbox(true);
    Keyboard.dismiss();
    try {
      const referralCode = await readPendingReferralCode();
      const response = await postJson<{ email: string; referral_code?: string }, LoginResponse>("/auth/login", { email: normalized, ...(referralCode ? { referral_code: referralCode } : {}) });
      if (referralCode) await clearPendingReferralCode().catch(() => undefined);
      if (version !== requestVersion.current) return;
      const parsedExpiry = Date.parse(response.expires_at);
      setHandoff(response.handoff_token_hash ? {
        token: response.handoff_token_hash,
        expiresAt: Number.isFinite(parsedExpiry) ? parsedExpiry : Date.now() + 15 * 60_000,
      } : null);
    } catch (emailError) {
      if (version === requestVersion.current) {
        setCheckInbox(false);
        setError(messageFor(emailError));
      }
    } finally {
      if (version === requestVersion.current) requestPending.current = false;
    }
  };

  if (completingSignIn) return <AuthSplashScreen />;

  return (
    <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.root}>
      <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" pointerEvents="none" style={styles.neuralBackdrop}>
        <NeuralBackdrop height={height} width={width} />
      </View>
      <View style={styles.atmosphere} pointerEvents="none" />
      <ScrollView
        contentContainerStyle={[styles.scrollContent, { paddingBottom: insets.bottom + spacing.lg, paddingTop: insets.top + spacing.lg }]}
        keyboardDismissMode="interactive"
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.content}>
          <View style={styles.brand}>
            <ChromeIcon glow={0.55} size={86} source={vorinthexMarkSource} />
            <Text style={styles.eyebrow}>VORINTHEX AI</Text>
            <Text accessibilityRole="header" style={styles.title}>Access your personal AI</Text>
            <Text style={styles.subtitle}>Your intelligence, memory, and tools, all in one place.</Text>
          </View>

          <View style={styles.panel}>
            <Button disabled={busy} icon={<GoogleIcon />} loading={loading === "google"} onPress={() => void oauth("google")} size="lg" variant="secondary">Continue with Google</Button>
            <Button disabled={busy} icon={<AppleIcon />} loading={loading === "apple"} onPress={() => void oauth("apple")} size="lg" variant="secondary">Continue with Apple</Button>
            <Button disabled={busy} icon={<MailIcon />} onPress={selectEmail} size="lg" variant="secondary">Continue with email</Button>
            {!emailVisible && (error || params.oauth_error) ? <Text accessibilityLiveRegion="polite" style={styles.error}>{error ?? "Sign in could not be completed. Please try again."}</Text> : null}
          </View>
          <Text style={styles.legalNote}>
              By continuing, you agree to our{" "}
              <Text accessibilityRole="link" onPress={() => void Linking.openURL(`${FRONTEND_URL}/terms`)} style={styles.legalLink}>Terms of Service</Text>
              {" "}and{" "}
              <Text accessibilityRole="link" onPress={() => void Linking.openURL(`${FRONTEND_URL}/privacy`)} style={styles.legalLink}>Privacy Policy</Text>.
          </Text>
          <View style={styles.disclosure}>
            <Text style={styles.disclosureTitle}>AI-powered features</Text>
            <Text style={styles.disclosureCopy}>Vorinthex AI uses artificial intelligence to generate and process text, images, audio and video.</Text>
            <Text style={styles.disclosureCopy}>Your information is hosted and processed in the United States. See our Privacy Policy for international-transfer details.</Text>
          </View>
        </View>
      </ScrollView>
      <BottomSheet footer={checkInbox ? <Button onPress={closeEmail} size="md" variant="secondary">Close</Button> : <View style={styles.sheetActions}><Button disabled={!email.trim()} onPress={() => void submitEmail()} size="md" variant="primary">Continue</Button><Button onPress={closeEmail} size="md" variant="secondary">Close</Button></View>} height="full" hideCloseButton hideHeading={checkInbox} onOpenChange={(open) => { if (!open) closeEmail(); }} open={emailVisible} pageKey={checkInbox ? "sent" : "email"} pageTransitionOrigin="bottom" title={checkInbox ? "Check your inbox" : "Continue with email"}>
        {checkInbox ? <View accessibilityLiveRegion="polite" style={styles.sheetMessage}>
          <MailIcon size="xl" variant="accent" />
          <Text accessibilityRole="header" style={styles.sheetTitle}>Check your inbox</Text>
          <Text style={styles.sheetDescription}>A sign-in email has been sent to {submittedEmail}. Check your inbox to sign in.</Text>
        </View> : <View style={styles.emailForm}>
          <Text style={styles.inputLabel}>Email address</Text>
          <TextInput accessibilityLabel="Email address" accessibilityHint={emailInvalid ? error ?? undefined : "Enter the email address for your account"} aria-invalid={emailInvalid} autoCapitalize="none" autoComplete="email" autoCorrect={false} keyboardType="email-address" onChangeText={(value) => { setEmail(value); if (error) setError(null); }} onSubmitEditing={() => void submitEmail()} placeholder="Email address" returnKeyType="send" style={emailInvalid && styles.inputError} textContentType="emailAddress" value={email} />
          {error ? <Text accessibilityLiveRegion="polite" style={styles.error}>{error}</Text> : null}
        </View>}
      </BottomSheet>
      <BottomSheet footer={<Button onPress={() => router.setParams({ link_error: undefined })} size="md" variant="secondary">Close</Button>} height="full" hideCloseButton hideHeading onOpenChange={(open) => { if (!open) router.setParams({ link_error: undefined }); }} open={invalidLinkVisible} title="Invalid sign-in link">
        <View style={styles.sheetMessage}>
          <LinkOffIcon size="xl" />
          <Text accessibilityRole="header" style={styles.sheetTitle}>Invalid sign-in link</Text>
          <Text style={styles.sheetDescription}>This link is invalid, expired, or has already been used. Request a new sign-in email to try again.</Text>
        </View>
      </BottomSheet>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: palette.page },
  neuralBackdrop: { position: "absolute", inset: 0, opacity: 0.72 },
  scrollContent: { flexGrow: 1, justifyContent: "center", paddingHorizontal: spacing.lg },
  content: { alignSelf: "center", width: "100%", maxWidth: 420, gap: spacing.xl },
  atmosphere: { position: "absolute", top: "8%", left: "16%", width: "68%", aspectRatio: 1, borderRadius: 999, backgroundColor: "rgba(174,182,188,0.055)", boxShadow: "0 0 100px rgba(221,226,229,0.12)" },
  brand: { alignItems: "center" },
  eyebrow: { marginTop: spacing.lg, color: palette.silver500, fontFamily: fonts.medium, fontSize: 10, letterSpacing: tracking.label },
  title: { marginTop: spacing.sm, color: palette.silver50, fontFamily: fonts.light, fontSize: 34, lineHeight: 40, letterSpacing: -1.2, textAlign: "center" },
  subtitle: { maxWidth: 340, marginTop: spacing.sm, color: palette.silver300, fontFamily: fonts.regular, fontSize: 14, lineHeight: 21, textAlign: "center" },
  panel: { gap: 12 },
  emailForm: { flex: 1, gap: 12 },
  inputLabel: { marginLeft: 2, color: palette.silver300, fontFamily: fonts.medium, fontSize: 12, letterSpacing: 0.4 },
  inputError: { borderColor: "#D98B8B" },
  sheetActions: { gap: spacing.sm },
  sheetMessage: { flex: 1, alignItems: "center", justifyContent: "center", gap: spacing.lg, paddingHorizontal: spacing.md },
  sheetTitle: { color: palette.silver50, fontFamily: fonts.medium, fontSize: 24, textAlign: "center" },
  sheetDescription: { maxWidth: 350, color: palette.silver300, fontFamily: fonts.regular, fontSize: 15, lineHeight: 23, textAlign: "center" },
  error: { paddingHorizontal: spacing.sm, color: "#D98B8B", fontFamily: fonts.regular, fontSize: 13, lineHeight: 18, textAlign: "center" },
  legalNote: { alignSelf: "center", maxWidth: 330, color: palette.silver500, fontFamily: fonts.regular, fontSize: 11, lineHeight: 16, textAlign: "center" },
  legalLink: { color: palette.silver300, textDecorationLine: "underline" },
  disclosure: { alignSelf: "center", borderTopColor: palette.hairline, borderTopWidth: 1, gap: spacing.xs, maxWidth: 360, paddingTop: spacing.md, width: "100%" },
  disclosureTitle: { color: palette.silver300, fontFamily: fonts.medium, fontSize: 12, textAlign: "center" },
  disclosureCopy: { color: palette.silver500, fontFamily: fonts.regular, fontSize: 11, lineHeight: 17, textAlign: "center" },
});
