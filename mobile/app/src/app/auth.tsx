import { AppleIcon, GoogleIcon, MailIcon } from "@vorinthex/shared/ui/icons-mobile";
import { Button } from "@vorinthex/shared/ui/button";
import { Spinner } from "@vorinthex/shared/ui/spinner";
import { TextInput } from "@vorinthex/shared/ui/text-input";
import { isAxiosError } from "axios";
import * as Linking from "expo-linking";
import { useEffect, useState } from "react";
import { AccessibilityInfo, Keyboard, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { vorinthexMarkSource } from "@/data/capability-icons";
import { ChromeIcon } from "@/components/ChromeIcon";
import { ChromePanel } from "@/components/ChromePanel";
import { NeuralBackdrop } from "@/components/NeuralBackdrop";
import { getJson, postJson } from "@/lib/api-client";
import { launchOAuthProvider, type OAuthProvider } from "@/lib/oauth";
import { useAuthStore } from "@/state/auth";
import { fonts, palette, spacing, tracking } from "@/theme/tokens";

type LoginResponse = {
  handoff_token_hash?: string;
  handoff_expires_at?: string;
  organization_mfa_required?: boolean;
};

const FRONTEND_URL = (process.env.EXPO_PUBLIC_FRONTEND_URL ?? "https://vorinthex.com").replace(/\/$/, "");

function messageFor(error: unknown) {
  if (isAxiosError<{ error?: string }>(error)) {
    return error.response?.data?.error ?? (error.response ? "Sign in could not be completed." : "Check your connection and try again.");
  }
  return error instanceof Error ? error.message : "Sign in could not be completed.";
}

export default function AuthRoute() {
  const insets = useSafeAreaInsets();
  const { height, width } = useWindowDimensions();
  const hydrate = useAuthStore((state) => state.hydrate);
  const [emailVisible, setEmailVisible] = useState(false);
  const [email, setEmail] = useState("");
  const [checkInbox, setCheckInbox] = useState(false);
  const [handoff, setHandoff] = useState<{ token: string; expiresAt: number } | null>(null);
  const [claimingHandoff, setClaimingHandoff] = useState(false);
  const [loading, setLoading] = useState<OAuthProvider | "email" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const busy = loading !== null;
  const emailInvalid = error === "Enter a valid email address.";

  useEffect(() => {
    if (!handoff) return;
    let active = true;
    let claiming = false;
    const poll = async () => {
      if (claiming) return;
      if (Date.now() >= handoff.expiresAt) {
        if (active) {
          setCheckInbox(false);
          setEmailVisible(true);
          setHandoff(null);
          setError("That sign-in link expired. Request a new one.");
        }
        return;
      }
      try {
        const status = await getJson<{ status: string }>(`/auth/handoff/status?handoff=${encodeURIComponent(handoff.token)}`);
        if (!active || status.status !== "approved" || claiming) return;
        claiming = true;
        setClaimingHandoff(true);
        const claim = await postJson<{ handoff_token_hash: string }, { status: string }>(
          "/auth/handoff/claim",
          { handoff_token_hash: handoff.token },
        );
        if (!active) return;
        if (claim.status === "authenticated") {
          await hydrate();
          if (!active) return;
          claiming = false;
          setClaimingHandoff(false);
        } else {
          claiming = false;
          setClaimingHandoff(false);
          setError("This account requires an additional verification step on the web.");
        }
      } catch (pollError) {
        claiming = false;
        if (active) setClaimingHandoff(false);
        if (isAxiosError(pollError) && !pollError.response) return;
        if (active) setError(messageFor(pollError));
      }
    };
    void poll();
    const interval = setInterval(() => void poll(), 2_000);
    return () => {
      active = false;
      clearInterval(interval);
    };
  }, [handoff, hydrate]);

  useEffect(() => {
    if (error && Platform.OS === "ios") AccessibilityInfo.announceForAccessibility(error);
  }, [error]);

  const oauth = async (provider: OAuthProvider) => {
    setError(null);
    setLoading(provider);
    try {
      if (await launchOAuthProvider(provider)) {
        await hydrate();
      }
    } catch (oauthError) {
      setError(messageFor(oauthError));
    } finally {
      setLoading(null);
    }
  };

  const submitEmail = async () => {
    const normalized = email.trim().toLowerCase();
    if (!/^\S+@\S+\.\S+$/.test(normalized)) {
      setError("Enter a valid email address.");
      return;
    }
    setError(null);
    setLoading("email");
    try {
      const response = await postJson<{ email: string }, LoginResponse>("/auth/login", { email: normalized });
      if (response.organization_mfa_required) {
        setError("This organization requires an additional verification step on the web.");
        return;
      }
      const parsedExpiry = response.handoff_expires_at ? Date.parse(response.handoff_expires_at) : Number.NaN;
      setCheckInbox(true);
      setHandoff(response.handoff_token_hash ? {
        token: response.handoff_token_hash,
        expiresAt: Number.isFinite(parsedExpiry) ? parsedExpiry : Date.now() + 15 * 60_000,
      } : null);
    } catch (emailError) {
      setError(messageFor(emailError));
    } finally {
      setLoading(null);
    }
  };

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
            <Text accessibilityRole="header" style={styles.title}>{checkInbox ? "Check your inbox" : "Access your personal AI"}</Text>
            <Text style={styles.subtitle}>
              {checkInbox ? `We sent a secure 15-minute sign-in link to ${email.trim()}. ${handoff ? "This screen will continue automatically." : "Open it on this device to continue."}` : "Your intelligence, memory, and tools, all in one place."}
            </Text>
          </View>

          <ChromePanel accessibilityViewIsModal={false} radius={28} style={styles.panel}>
            {checkInbox ? (
              <>
                <View accessibilityLiveRegion="polite" accessibilityState={{ busy: Boolean(handoff) }} style={styles.waiting}>
                  {handoff ? <Spinner accessibilityLabel="Waiting for sign-in link" size="small" variant="muted" /> : <MailIcon size="lg" variant="accent" />}
                  <Text style={styles.waitingText}>{handoff ? "Waiting for your link" : "Ready when you are"}</Text>
                </View>
                <Button disabled={claimingHandoff} loading={claimingHandoff} onPress={() => { setCheckInbox(false); setHandoff(null); setError(null); }} size="lg" variant="ghost">Use another email</Button>
              </>
            ) : (
              <>
                {emailVisible ? (
                  <View style={styles.emailForm}>
                    <Text style={styles.inputLabel}>Email address</Text>
                    <TextInput
                      accessibilityLabel="Email address"
                      accessibilityHint={emailInvalid ? error ?? undefined : "Enter the email address for your account"}
                      aria-invalid={emailInvalid}
                      autoCapitalize="none"
                      autoComplete="email"
                      autoCorrect={false}
                      editable={!busy}
                      keyboardType="email-address"
                      onChangeText={(value) => { setEmail(value); if (error) setError(null); }}
                      onSubmitEditing={() => { Keyboard.dismiss(); void submitEmail(); }}
                      placeholder="you@example.com"
                      returnKeyType="send"
                      style={[styles.input, emailInvalid && styles.inputError]}
                      textContentType="emailAddress"
                      value={email}
                    />
                    <Button disabled={busy || !email.trim()} loading={loading === "email"} onPress={() => void submitEmail()} size="lg" variant="primary">Continue</Button>
                    <Button disabled={busy} onPress={() => { setEmailVisible(false); setError(null); Keyboard.dismiss(); }} size="sm" variant="ghost">Back</Button>
                  </View>
                ) : (
                  <>
                    <Button disabled={busy} icon={<GoogleIcon />} loading={loading === "google"} onPress={() => void oauth("google")} size="lg" variant="secondary">Continue with Google</Button>
                    <Button disabled={busy} icon={<AppleIcon />} loading={loading === "apple"} onPress={() => void oauth("apple")} size="lg" variant="secondary">Continue with Apple</Button>
                    <Button disabled={busy} icon={<MailIcon />} loading={loading === "email"} onPress={() => { setError(null); setEmailVisible(true); }} size="lg" variant="secondary">Continue with email</Button>
                  </>
                )}
              </>
            )}
            {error && <Text accessibilityLiveRegion="polite" style={styles.error}>{error}</Text>}
          </ChromePanel>
          {!checkInbox && (
            <Text style={styles.legalNote}>
              By continuing, you agree to our{" "}
              <Text accessibilityRole="link" onPress={() => void Linking.openURL(`${FRONTEND_URL}/terms`)} style={styles.legalLink}>Terms of Service</Text>
              {" "}and{" "}
              <Text accessibilityRole="link" onPress={() => void Linking.openURL(`${FRONTEND_URL}/privacy`)} style={styles.legalLink}>Privacy Policy</Text>.
            </Text>
          )}
        </View>
      </ScrollView>
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
  panel: { gap: 12, padding: spacing.md },
  emailForm: { gap: 12 },
  inputLabel: { marginLeft: 2, color: palette.silver300, fontFamily: fonts.medium, fontSize: 12, letterSpacing: 0.4 },
  input: { minHeight: 50, backgroundColor: palette.obsidian850 },
  inputError: { borderColor: "#D98B8B" },
  waiting: { minHeight: 76, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 12, borderRadius: 22, borderWidth: 1, borderColor: palette.hairline },
  waitingText: { color: palette.silver300, fontFamily: fonts.medium, fontSize: 13, letterSpacing: 0.6 },
  error: { paddingHorizontal: spacing.sm, color: "#D98B8B", fontFamily: fonts.regular, fontSize: 13, lineHeight: 18, textAlign: "center" },
  legalNote: { alignSelf: "center", maxWidth: 330, color: palette.silver500, fontFamily: fonts.regular, fontSize: 11, lineHeight: 16, textAlign: "center" },
  legalLink: { color: palette.silver300, textDecorationLine: "underline" },
});
