import { useRouter } from "expo-router";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { useEffect, useState } from "react";
import { AccessibilityInfo, StyleSheet, Text, View } from "react-native";
import Animated, { useAnimatedStyle, useSharedValue, withDelay, withTiming } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Button } from "@vorinthex/shared/ui/button";

import { INTRO_FRAMES, INTRO_STEPS } from "@/data/intro-steps";
import { getLocalOnboardingState, markOnboardingPreviewComplete, subscribeLocalOnboardingState } from "@/lib/onboarding-state";
import { durations, easings } from "@/theme/motion";
import { fonts, palette, spacing } from "@/theme/tokens";

function RollingCopy({ description, reducedMotion, title }: { description: string; reducedMotion: boolean; title: string }) {
  const titleProgress = useSharedValue(reducedMotion ? 1 : 0);
  const descriptionProgress = useSharedValue(reducedMotion ? 1 : 0);
  useEffect(() => {
    if (reducedMotion) {
      titleProgress.value = 1;
      descriptionProgress.value = 1;
      return;
    }
    titleProgress.value = 0;
    descriptionProgress.value = 0;
    titleProgress.value = withDelay(60, withTiming(1, { duration: durations.reveal, easing: easings.luxury }));
    descriptionProgress.value = withDelay(200, withTiming(1, { duration: durations.reveal, easing: easings.luxury }));
  }, [descriptionProgress, reducedMotion, titleProgress]);
  const titleStyle = useAnimatedStyle(() => ({ opacity: titleProgress.value, transform: [{ translateY: (1 - titleProgress.value) * 30 }] }));
  const descriptionStyle = useAnimatedStyle(() => ({ opacity: descriptionProgress.value, transform: [{ translateY: (1 - descriptionProgress.value) * 24 }] }));

  return <View accessibilityLiveRegion="polite" style={styles.copy}>
    <View style={styles.reveal}><Animated.Text accessibilityRole="header" style={[styles.title, titleStyle]}>{title}</Animated.Text></View>
    <View style={styles.reveal}><Animated.Text style={[styles.description, descriptionStyle]}>{description}</Animated.Text></View>
  </View>;
}

export default function IntroRoute() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [stepIndex, setStepIndex] = useState(0);
  const [reducedMotion, setReducedMotion] = useState(false);
  const [finishing, setFinishing] = useState(false);
  const [deletionPending, setDeletionPending] = useState(() => getLocalOnboardingState().deletionPending === true);
  const [error, setError] = useState(false);
  useEffect(() => {
    if (getLocalOnboardingState().previewComplete) router.replace("/auth");
    void AccessibilityInfo.isReduceMotionEnabled().then(setReducedMotion);
    const subscription = AccessibilityInfo.addEventListener("reduceMotionChanged", setReducedMotion);
    const unsubscribe = subscribeLocalOnboardingState((state) => setDeletionPending(state.deletionPending === true));
    return () => { subscription.remove(); unsubscribe(); };
  }, [router]);
  const step = INTRO_STEPS[stepIndex]!;
  const last = stepIndex === INTRO_STEPS.length - 1;

  const next = async () => {
    if (!last) { setStepIndex((current) => current + 1); return; }
    if (finishing || deletionPending) return;
    setFinishing(true);
    setError(false);
    try {
      await markOnboardingPreviewComplete();
      router.replace("/auth");
    } catch {
      setError(true);
      setFinishing(false);
    }
  };

  return <View style={[styles.root, { paddingTop: insets.top + spacing.lg, paddingBottom: Math.max(insets.bottom, spacing.md) + spacing.md }]}>
    <Image accessible={false} contentFit="cover" pointerEvents="none" source={INTRO_FRAMES[stepIndex]} style={StyleSheet.absoluteFill} />
    <LinearGradient colors={["rgba(3,5,7,0.96)", "rgba(3,5,7,0.78)", "rgba(3,5,7,0)"]} locations={[0, 0.45, 1]} pointerEvents="none" style={[styles.topShade, { height: insets.top + 350 }]} />
    <LinearGradient colors={["rgba(3,5,7,0)", "rgba(3,5,7,0.85)"]} pointerEvents="none" style={[styles.bottomShade, { height: Math.max(insets.bottom + 130, 160) }]} />
    <Text style={styles.progress}>{String(stepIndex + 1).padStart(2, "0")} / {INTRO_STEPS.length}</Text>
    <RollingCopy description={step.description} key={stepIndex} reducedMotion={reducedMotion} title={step.title} />
    <View style={styles.fill} />
    <View style={styles.footer}>
      {error ? <Text accessibilityRole="alert" style={styles.error}>Could not save your progress. Please try again.</Text> : null}
      {last && deletionPending ? <Text accessibilityLiveRegion="polite" style={styles.error}>Finishing account deletion...</Text> : null}
      <Button disabled={finishing || last && deletionPending} loading={finishing} onPress={() => void next()} size="md" style={styles.action} variant="primary">{last ? "Get started" : "Next"}</Button>
    </View>
  </View>;
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: palette.page, paddingHorizontal: spacing.lg },
  topShade: { position: "absolute", top: 0, left: 0, right: 0 },
  bottomShade: { position: "absolute", bottom: 0, left: 0, right: 0 },
  progress: { color: palette.silver300, fontFamily: fonts.medium, fontSize: 12, letterSpacing: 2 },
  copy: { alignSelf: "flex-start", gap: spacing.sm, marginTop: spacing.lg, maxWidth: 420, width: "100%" },
  reveal: { overflow: "hidden" },
  title: { color: palette.silver50, fontFamily: fonts.light, fontSize: 42, lineHeight: 50 },
  description: { color: palette.silver100, fontFamily: fonts.regular, fontSize: 16, lineHeight: 24, maxWidth: 360 },
  fill: { flex: 1 },
  footer: { gap: spacing.sm },
  action: { width: "100%" },
  error: { color: palette.danger, fontFamily: fonts.regular, fontSize: 13 },
});
