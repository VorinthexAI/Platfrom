import { Button } from "@vorinthex/shared/ui/button";
import { Spinner } from "@vorinthex/shared/ui/spinner";
import { TextInput } from "@vorinthex/shared/ui/text-input";
import { TotpSetup } from "@vorinthex/shared/ui/components";
import { useQueryClient } from "@tanstack/react-query";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";

import { postJson } from "@/lib/api-client";
import { queryBelongsToTeamScope, selectTeam, takePendingTeamMfa } from "@/lib/team-client";
import { useAuthStore } from "@/state/auth";
import { fonts, palette, spacing } from "@/theme/tokens";

const TOKEN = /^[a-f0-9]{64}$/;
const CODE = /^\d{6}$/;
type Setup = { challenge: string; otpauthUri: string; qrCodeImageSrc: string; secret: string };
type State = { kind: "loading" } | { kind: "invalid" } | { kind: "verify"; challenge: string } | { kind: "setup"; setup: Setup; firstCode?: string };

function setupFrom(value: Record<string, unknown>): Setup | null {
  return typeof value.setup_challenge_token_hash === "string" && TOKEN.test(value.setup_challenge_token_hash)
    && typeof value.otpauth_url === "string" && value.otpauth_url.startsWith("otpauth://totp/")
    && typeof value.qr_code_data_url === "string" && value.qr_code_data_url.startsWith("data:image/")
    && typeof value.secret === "string" && value.secret.length > 0
    ? { challenge: value.setup_challenge_token_hash, otpauthUri: value.otpauth_url, qrCodeImageSrc: value.qr_code_data_url, secret: value.secret }
    : null;
}

export default function TeamMfaRoute() {
  const params = useLocalSearchParams<{ token_hash?: string }>();
  const router = useRouter();
  const queryClient = useQueryClient();
  const hydrate = useAuthStore((value) => value.hydrate);
  const pending = useRef(takePendingTeamMfa());
  const recoveryToken = useRef(typeof params.token_hash === "string" && TOKEN.test(params.token_hash) ? params.token_hash : null);
  const [state, setState] = useState<State>({ kind: "loading" });
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [resetSent, setResetSent] = useState(false);
  const resetRequested = useRef(false);

  useEffect(() => {
    const token = recoveryToken.current;
    recoveryToken.current = null;
    router.setParams({ token_hash: undefined });
    const challenge = pending.current;
    const start = async () => {
      if (token) {
        const result = await postJson<{ token_hash: string }, Record<string, unknown>>("/auth/magic/validate", { token_hash: token });
        const setup = setupFrom(result);
        setState(setup ? { kind: "setup", setup } : { kind: "invalid" });
        return;
      }
      if (!challenge) { setState({ kind: "invalid" }); return; }
      if (challenge.status === "totp_required") { setState({ kind: "verify", challenge: challenge.challengeToken }); return; }
      const result = await postJson<{ challenge_token_hash: string }, Record<string, unknown>>("/auth/totp/setup/start", { challenge_token_hash: challenge.challengeToken });
      const setup = setupFrom(result);
      setState(setup ? { kind: "setup", setup } : { kind: "invalid" });
    };
    void start().catch(() => setState({ kind: "invalid" }));
  }, [router]);

  const finish = async () => {
    if (!CODE.test(code) || (state.kind !== "setup" && state.kind !== "verify")) return;
    if (state.kind === "setup" && !state.firstCode) {
      setState({ ...state, firstCode: code });
      setCode("");
      return;
    }
    setSubmitting(true);
    setError("");
    const previousTeamKey = String(useAuthStore.getState().team?.key ?? "");
    const previousScopeKey = String(useAuthStore.getState().scope?.key ?? "");
    try {
      const result = state.kind === "verify"
        ? await postJson<{ challenge_token_hash: string; code: string }, { teamKey: string; scopeKey?: string }>("/auth/totp/verify", { challenge_token_hash: state.challenge!, code })
        : await postJson<{ challenge_token_hash: string; codes: [string, string] }, { teamKey: string; scopeKey?: string }>("/auth/totp/setup/complete", { challenge_token_hash: state.setup.challenge, codes: [state.firstCode!, code] });
      const selected = await selectTeam(result.teamKey, result.scopeKey);
      if (selected.status !== "selected") throw new Error("Team assurance did not complete.");
      await hydrate();
      await queryClient.cancelQueries({ predicate: ({ queryKey }) => queryBelongsToTeamScope(queryKey, previousTeamKey, previousScopeKey) });
      queryClient.removeQueries({ predicate: ({ queryKey }) => queryBelongsToTeamScope(queryKey, previousTeamKey, previousScopeKey) });
      router.replace("/profile");
    } catch {
      setError("That code could not be verified. Check your authenticator and try again.");
      setCode("");
    } finally { setSubmitting(false); }
  };

  const requestReset = async () => {
    if (state.kind !== "verify" || !state.challenge || resetRequested.current) return;
    resetRequested.current = true;
    setResetSent(true);
    await postJson<{ challenge_token_hash: string }, unknown>("/auth/totp/reset/request", { challenge_token_hash: state.challenge }).catch(() => undefined);
  };

  if (state.kind === "loading") return <View style={styles.center}><Spinner size="large" /><Text style={styles.body}>Preparing team security...</Text></View>;
  if (state.kind === "invalid") return <View style={styles.center}><Text accessibilityRole="header" style={styles.title}>Link unavailable</Text><Text style={styles.body}>This secure link is invalid, expired, or already used.</Text><Button onPress={() => router.replace("/auth")} size="lg" variant="primary">Return to sign in</Button></View>;
  const setup = state.kind === "setup";
  const firstCode = setup && Boolean(state.firstCode);
  const form = <View style={styles.form}>{resetSent ? <Text accessibilityLiveRegion="polite" style={styles.notice}>Check your email for a recovery link. It expires in 15 minutes.</Text> : <><Text style={styles.label}>{firstCode ? "Next authenticator code" : "Six-digit authenticator code"}</Text><TextInput accessibilityLabel={firstCode ? "Next authenticator code" : "Six-digit authenticator code"} autoFocus keyboardType="number-pad" maxLength={6} onChangeText={(value) => { setCode(value.replace(/\D/g, "").slice(0, 6)); setError(""); }} value={code} />{firstCode ? <Text accessibilityLiveRegion="polite" style={styles.notice}>First code accepted. Wait for the authenticator period to change, then enter the next code.</Text> : null}{error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}<Button disabled={!CODE.test(code)} loading={submitting} onPress={() => void finish()} size="lg" variant="primary">{setup ? firstCode ? "Complete setup" : "Accept first code" : "Verify and continue"}</Button>{!setup ? <Button onPress={() => void requestReset()} size="lg" variant="secondary">Request reset</Button> : null}</>}</View>;
  return <ScrollView contentContainerStyle={styles.content}>{setup ? <TotpSetup accountLabel="this team" issuerLabel="Vorinthex" otpauthUri={state.setup.otpauthUri} qrCodeImageSrc={state.setup.qrCodeImageSrc}><Text selectable style={styles.secret}>Manual key: {state.setup.secret}</Text>{form}</TotpSetup> : <View style={styles.card}><Text accessibilityRole="header" style={styles.title}>Confirm it’s you</Text><Text style={styles.body}>Enter the current code from your authenticator app.</Text>{form}</View>}</ScrollView>;
}

const styles = StyleSheet.create({
  content: { backgroundColor: palette.page, flexGrow: 1, justifyContent: "center", padding: spacing.xl },
  center: { alignItems: "center", backgroundColor: palette.page, flex: 1, gap: spacing.md, justifyContent: "center", padding: spacing.xl },
  card: { gap: spacing.md }, form: { gap: spacing.md, width: "100%" },
  title: { color: palette.silver50, fontFamily: fonts.medium, fontSize: 30, textAlign: "center" },
  body: { color: palette.silver300, fontFamily: fonts.regular, fontSize: 15, lineHeight: 22, textAlign: "center" },
  label: { color: palette.silver300, fontFamily: fonts.medium, fontSize: 12 },
  notice: { color: palette.silver300, fontFamily: fonts.regular, fontSize: 13, lineHeight: 20 },
  secret: { color: palette.silver100, fontFamily: fonts.medium, fontSize: 13, textAlign: "center" },
  error: { color: palette.danger, fontFamily: fonts.regular, fontSize: 13 },
});
