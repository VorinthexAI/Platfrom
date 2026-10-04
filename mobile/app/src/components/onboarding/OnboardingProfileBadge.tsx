import { Avatar } from "@vorinthex/shared/ui/avatar";
import { Button } from "@vorinthex/shared/ui/button";
import { Skeleton } from "@vorinthex/shared/ui/skeleton";
import * as Crypto from "expo-crypto";
import { useEffect, useState } from "react";
import { StyleSheet, Text, View } from "react-native";

import { profileInitial } from "@/lib/auth-helpers";
import { extractDomainErrorMessage } from "@/lib/domain-error-observer";
import { claimProfileBadge, generateProfileBadge, type ProfileBadgeCandidate } from "@/lib/profile-client";
import { recordOnboardingEvent } from "@/lib/onboarding-events";
import { useAuthStore } from "@/state/auth";
import { fonts, palette } from "@/theme/tokens";
import { OnboardingStepLayout } from "./OnboardingStepLayout";

const AVATAR_SIZE = 148;

export function OnboardingProfileBadge({ onFinished }: { onFinished: () => void }) {
  const user = useAuthStore((state) => state.user);
  const scopeKey = useAuthStore((state) => String(state.scope?.key ?? ""));
  const optimisticProfile = useAuthStore((state) => state.optimisticProfile);
  const [candidate, setCandidate] = useState<ProfileBadgeCandidate>();
  const [generating, setGenerating] = useState(false);
  const [claiming, setClaiming] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => { void recordOnboardingEvent("onboarding.profile-badge").catch(() => undefined); }, []);

  const skip = () => {
    if (generating || claiming) return;
    void recordOnboardingEvent("onboarding.profile-badge.skipped").catch(() => undefined);
    onFinished();
  };
  const generate = async () => {
    if (!scopeKey || generating) return;
    setError("");
    setGenerating(true);
    try { setCandidate(await generateProfileBadge(scopeKey, Crypto.randomUUID())); }
    catch (cause) { setError(extractDomainErrorMessage(cause) ?? "Your profile badge could not be generated. Please try again."); }
    finally { setGenerating(false); }
  };
  const claim = async () => {
    if (!candidate || !scopeKey || claiming) return;
    setError("");
    setClaiming(true);
    const update = optimisticProfile({ avatarUrl: candidate.avatarUrl });
    try {
      const profile = await claimProfileBadge(scopeKey, candidate.candidateKey);
      update.reconcile(profile.avatarUrl ? profile : { avatarUrl: candidate.avatarUrl });
      void recordOnboardingEvent("onboarding.profile-badge.claimed").catch(() => undefined);
      onFinished();
    } catch (cause) {
      update.rollback();
      if (Date.parse(candidate.expiresAt) <= Date.now()) setCandidate(undefined);
      setError(extractDomainErrorMessage(cause) ?? "Your profile badge could not be claimed. Please try again.");
      setClaiming(false);
    }
  };

  return <OnboardingStepLayout
    action={<><Button disabled={!scopeKey || generating || claiming} loading={generating || claiming} onPress={() => void (candidate ? claim() : generate())} size="md" variant="primary">{candidate ? "Claim badge" : "Generate badge"}</Button><Button disabled={generating || claiming} onPress={skip} size="md" variant="secondary">Skip</Button></>}
    closeDisabled={generating || claiming}
    closeLabel="Skip profile badge"
    description="Create a personal badge for your profile."
    descriptionAfterChildren
    onClose={skip}
    title="Your profile badge"
  >
    <View style={styles.preview}>
      <Avatar fallback={profileInitial(user)} size={AVATAR_SIZE} style={styles.avatar} uri={candidate?.avatarUrl ?? user?.avatarUrl}>
        {generating ? <Skeleton accessibilityLabel="Generating profile badge" accessibilityRole="progressbar" style={styles.skeleton} /> : undefined}
      </Avatar>
    </View>
    {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
  </OnboardingStepLayout>;
}

const styles = StyleSheet.create({
  avatar: { backgroundColor: palette.voidBlack },
  preview: { borderColor: palette.hairlineBright, borderRadius: 999, borderWidth: 1, overflow: "hidden" },
  skeleton: { backgroundColor: palette.hairlineBright, borderColor: palette.hairline, borderRadius: 999, borderWidth: 1, height: AVATAR_SIZE, opacity: 0.72, overflow: "hidden", width: AVATAR_SIZE },
  error: { color: palette.danger, fontFamily: fonts.regular, fontSize: 12, lineHeight: 18, maxWidth: 320, textAlign: "center" },
});
