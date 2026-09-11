import { Avatar } from "@vorinthex/shared/ui/avatar";
import { Button } from "@vorinthex/shared/ui/button";
import { Skeleton } from "@vorinthex/shared/ui/skeleton";
import * as Crypto from "expo-crypto";
import { useEffect, useState } from "react";
import { StyleSheet, Text, View } from "react-native";

import { firstNameFor } from "@/lib/auth-helpers";
import { claimProfileBadge, generateProfileBadge, type ProfileBadgeCandidate } from "@/lib/profile-client";
import { recordOnboardingEvent } from "@/lib/onboarding-events";
import { useAppsStore } from "@/state/apps";
import { useAuthStore } from "@/state/auth";
import { fonts, palette } from "@/theme/tokens";

import { OnboardingStepLayout } from "./OnboardingStepLayout";

const AVATAR_SIZE = 148;
function keyOf(value: Record<string, unknown> | null) { return typeof value?.key === "string" ? value.key : ""; }

export function OnboardingProfileBadge({ onFinished }: { onFinished: () => void }) {
  const user = useAuthStore((state) => state.user);
  const team = useAuthStore((state) => state.team);
  const scope = useAuthStore((state) => state.scope);
  const optimisticProfile = useAuthStore((state) => state.optimisticProfile);
  const cost = useAppsStore((state) => state.capabilityCosts["profile.badge.generate"]);
  const refreshCosts = useAppsStore((state) => state.refreshProducts);
  const [candidate, setCandidate] = useState<ProfileBadgeCandidate>();
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => { void recordOnboardingEvent("onboarding.profile-badge").catch(() => undefined); }, []);

  const skip = () => {
    void recordOnboardingEvent("onboarding.profile-badge.skipped").catch(() => undefined);
    onFinished();
  };
  const generate = async () => {
    const teamKey = keyOf(team), scopeKey = keyOf(scope);
    if (!teamKey || !scopeKey || !cost || generating) return;
    setError("");
    setGenerating(true);
    try { setCandidate(await generateProfileBadge(teamKey, scopeKey, Crypto.randomUUID())); }
    catch { setError("Your profile badge could not be generated. Please try again."); }
    finally { setGenerating(false); }
  };
  const claim = () => {
    if (!candidate) return;
    const teamKey = keyOf(team), scopeKey = keyOf(scope);
    if (!teamKey || !scopeKey) return;
    const update = optimisticProfile({ avatarUrl: candidate.avatarUrl });
    void claimProfileBadge(teamKey, scopeKey, candidate.candidateKey)
      .then((profile) => update.reconcile(profile.avatarUrl ? profile : { avatarUrl: candidate.avatarUrl }))
      .catch(() => update.rollback());
    void recordOnboardingEvent("onboarding.profile-badge.claimed").catch(() => undefined);
    onFinished();
  };

  const description = cost
    ? `Generate a custom profile badge for ${cost.sparkCost} Sparks.`
    : "Generate a custom profile badge.";
  return <OnboardingStepLayout
    action={candidate
      ? <><Button onPress={claim} size="md" variant="primary">Claim</Button><Button onPress={skip} size="md" variant="secondary">Skip</Button></>
      : <><Button disabled={!cost || generating} onPress={() => void generate()} size="md" variant="primary">Generate badge</Button><Button disabled={generating} onPress={skip} size="md" variant="secondary">Skip</Button></>}
    closeDisabled={generating}
    closeLabel="Skip profile badge"
    description={description}
    descriptionAfterChildren
    onClose={skip}
    title="Your profile badge"
  >
    <View style={styles.preview}>
      <Avatar fallback={firstNameFor(user)} size={AVATAR_SIZE} style={styles.avatar} uri={candidate?.avatarUrl}>
        {generating ? <Skeleton accessibilityLabel="Generating profile badge" accessibilityRole="progressbar" style={styles.skeleton} /> : undefined}
      </Avatar>
    </View>
    {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
    {!cost ? <Button onPress={() => void refreshCosts()} size="md" variant="ghost">Refresh costs</Button> : null}
  </OnboardingStepLayout>;
}

const styles = StyleSheet.create({
  avatar: { backgroundColor: palette.voidBlack },
  preview: { borderColor: palette.hairlineBright, borderRadius: 999, borderWidth: 1, overflow: "hidden" },
  skeleton: { backgroundColor: palette.hairlineBright, borderColor: palette.hairline, borderRadius: 999, borderWidth: 1, height: AVATAR_SIZE, opacity: 0.72, overflow: "hidden", width: AVATAR_SIZE },
  error: { color: palette.danger, fontFamily: fonts.regular, fontSize: 12, lineHeight: 18, maxWidth: 320, textAlign: "center" },
});
