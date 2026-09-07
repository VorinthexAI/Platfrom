import { Button } from "@vorinthex/shared/ui/button";
import { ChromeIcon } from "@vorinthex/shared/ui/chrome-icon";
import { Image, type ImageSource } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { AccessibilityInfo, StyleSheet, useWindowDimensions, View } from "react-native";
import Animated, { useAnimatedStyle, useReducedMotion, useSharedValue, withDelay, withTiming } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Svg, { Defs, LinearGradient as SvgLinearGradient, Path, Stop } from "react-native-svg";

import { NeuralBackdrop } from "@/components/NeuralBackdrop";
import { assistantIconSource, capabilityIconSource, vorinthexMarkSource } from "@/data/capability-icons";
import type { ServerApp } from "@/lib/apps-registry";
import { recordOnboardingEvent, type OnboardingEventSlug } from "@/lib/onboarding-events";
import { easings } from "@/theme/motion";
import { fonts, palette, spacing, tracking } from "@/theme/tokens";

import { selectOnboardingAppStages, type OnboardingAppSlug, type OnboardingAppStage } from "./onboarding-stages";

const MISSION = "We’re building connected AI apps that share context, learn together, and make every part of your digital life more intelligent.";
const STAGE_REVEAL_MS = 1_000;

type Stage = { kind: "mission" } | { kind: "app"; app: OnboardingAppStage };

const LOCAL_APP_LOGOS = {
  archive: capabilityIconSource.archive,
  gallery: capabilityIconSource.gallery,
  compass: capabilityIconSource.compass,
  signal: capabilityIconSource.signal,
  ascend: capabilityIconSource.ascend,
  core: assistantIconSource,
} satisfies Record<OnboardingAppSlug, ImageSource>;

function logoSource(stage: Stage, prefetchedLogoUrls: ReadonlySet<string>) {
  if (stage.kind === "mission") return vorinthexMarkSource;
  return prefetchedLogoUrls.has(stage.app.logoUrl) ? { uri: stage.app.logoUrl } : LOCAL_APP_LOGOS[stage.app.slug];
}

function SheetSeparator({ width }: { width: number }) {
  return <Svg height={24} pointerEvents="none" width={width}>
    <Defs>
      <SvgLinearGradient id="onboarding-sheet-edge" x1="0" x2={width} y1="0" y2="0" gradientUnits="userSpaceOnUse">
        <Stop offset="0" stopColor="#DDE2E5" stopOpacity={0.08} />
        <Stop offset="0.5" stopColor="#FFFFFF" stopOpacity={0.48} />
        <Stop offset="1" stopColor="#DDE2E5" stopOpacity={0.08} />
      </SvgLinearGradient>
    </Defs>
    <Path d={`M 0 24 V 18 A 18 18 0 0 1 18 0 H ${width - 18} A 18 18 0 0 1 ${width} 18 V 24`} fill="none" stroke="url(#onboarding-sheet-edge)" strokeWidth={1} />
  </Svg>;
}

export function OnboardingIntroSequence({ apps, onFinished }: { apps: readonly ServerApp[]; onFinished: () => void }) {
  const insets = useSafeAreaInsets();
  const { height, width } = useWindowDimensions();
  const reducedMotion = useReducedMotion();
  const appStages = selectOnboardingAppStages(apps);
  const stages: Stage[] = [{ kind: "mission" }, ...appStages.map((app) => ({ kind: "app" as const, app }))];
  const [activeIndex, setActiveIndex] = useState(0);
  const [outgoingStage, setOutgoingStage] = useState<Stage>();
  const [prefetchedLogoUrls, setPrefetchedLogoUrls] = useState<ReadonlySet<string>>(() => new Set());
  const transitionLocked = useRef(false);
  const recordedEvents = useRef(new Set<OnboardingEventSlug>());
  const transitionTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const currentStage = stages[activeIndex] ?? stages[0]!;
  const isFinalStage = activeIndex === stages.length - 1;
  const outgoingOpacity = useSharedValue(1);
  const outgoingY = useSharedValue(50);
  const incomingOpacity = useSharedValue(1);
  const incomingY = useSharedValue(50);
  const missionLogoOpacity = useSharedValue(reducedMotion ? 1 : 0.3);
  const missionLogoOffset = useSharedValue(reducedMotion ? 0 : 70);
  const titleOpacity = useSharedValue(0.3);
  const descriptionOpacity = useSharedValue(0.3);
  const titleY = useSharedValue(32);
  const descriptionY = useSharedValue(32);
  const progress = useSharedValue(1 / stages.length);
  const announcement = currentStage.kind === "mission" ? `VORINTHEX AI. ${MISSION}` : `${currentStage.app.name}. ${currentStage.app.description}`;
  const eventSlug: OnboardingEventSlug = currentStage.kind === "mission" ? "onboarding.vorinthex-ai" : `onboarding.${currentStage.app.slug}`;
  const heroHeight = Math.max(280, height * 0.4);

  useLayoutEffect(() => {
    if (reducedMotion) return;
    missionLogoOpacity.value = withTiming(1, { duration: STAGE_REVEAL_MS, easing: easings.luxury });
    missionLogoOffset.value = withTiming(0, { duration: STAGE_REVEAL_MS, easing: easings.luxury });
  }, [missionLogoOffset, missionLogoOpacity, reducedMotion]);

  useEffect(() => {
    let mounted = true;
    for (const app of apps) {
      void Image.prefetch(app.logoUrl, "memory-disk").then((cached) => {
        if (!mounted || !cached) return;
        setPrefetchedLogoUrls((current) => current.has(app.logoUrl) ? current : new Set(current).add(app.logoUrl));
      }).catch(() => undefined);
    }
    return () => { mounted = false; };
  }, [apps]);

  useEffect(() => {
    AccessibilityInfo.announceForAccessibility(announcement);
    if (recordedEvents.current.has(eventSlug)) return;
    recordedEvents.current.add(eventSlug);
    void recordOnboardingEvent(eventSlug).catch(() => undefined);
  }, [announcement, eventSlug]);

  useEffect(() => {
    progress.value = withTiming((activeIndex + 1) / stages.length, { duration: 550, easing: easings.luxury });
  }, [activeIndex, progress, stages.length]);

  useEffect(() => () => {
    if (transitionTimer.current) clearTimeout(transitionTimer.current);
  }, []);

  useLayoutEffect(() => {
    if (reducedMotion) {
      titleOpacity.value = 1;
      descriptionOpacity.value = 1;
      titleY.value = 0;
      descriptionY.value = 0;
      return;
    }
    titleOpacity.value = 0.3;
    descriptionOpacity.value = 0.3;
    titleY.value = 32;
    descriptionY.value = 32;
    titleOpacity.value = withDelay(100, withTiming(1, { duration: STAGE_REVEAL_MS, easing: easings.luxury }));
    titleY.value = withDelay(100, withTiming(0, { duration: STAGE_REVEAL_MS, easing: easings.luxury }));
    descriptionOpacity.value = withDelay(180, withTiming(1, { duration: STAGE_REVEAL_MS, easing: easings.luxury }));
    descriptionY.value = withDelay(180, withTiming(0, { duration: STAGE_REVEAL_MS, easing: easings.luxury }));
  }, [activeIndex, descriptionOpacity, descriptionY, reducedMotion, titleOpacity, titleY]);

  useLayoutEffect(() => {
    if (!outgoingStage) return;
    outgoingOpacity.value = 1;
    outgoingY.value = 50;
    incomingOpacity.value = 0.3;
    incomingY.value = 120;
    outgoingOpacity.value = withTiming(0, { duration: STAGE_REVEAL_MS, easing: easings.luxury });
    outgoingY.value = withTiming(120, { duration: STAGE_REVEAL_MS, easing: easings.luxury });
    incomingOpacity.value = withTiming(1, { duration: STAGE_REVEAL_MS, easing: easings.luxury });
    incomingY.value = withTiming(50, { duration: STAGE_REVEAL_MS, easing: easings.luxury });
    transitionTimer.current = setTimeout(() => {
      setOutgoingStage(undefined);
      transitionLocked.current = false;
    }, STAGE_REVEAL_MS);
  }, [incomingOpacity, incomingY, outgoingOpacity, outgoingStage, outgoingY]);

  const outgoingStyle = useAnimatedStyle(() => ({ opacity: outgoingOpacity.value, transform: [{ translateY: outgoingY.value }] }));
  const incomingStyle = useAnimatedStyle(() => ({ opacity: incomingOpacity.value * missionLogoOpacity.value, transform: [{ translateY: incomingY.value + missionLogoOffset.value }] }));
  const titleStyle = useAnimatedStyle(() => ({ opacity: titleOpacity.value, transform: [{ translateY: titleY.value }] }));
  const descriptionStyle = useAnimatedStyle(() => ({ opacity: descriptionOpacity.value, transform: [{ translateY: descriptionY.value }] }));
  const progressStyle = useAnimatedStyle(() => ({ width: `${progress.value * 100}%` }));

  function next() {
    if (transitionLocked.current) return;
    transitionLocked.current = true;
    const nextStage = stages[activeIndex + 1];
    if (!nextStage) {
      onFinished();
      return;
    }
    if (reducedMotion) {
      setActiveIndex((index) => index + 1);
      transitionTimer.current = setTimeout(() => {
        transitionLocked.current = false;
      }, 0);
      return;
    }

    setOutgoingStage(currentStage);
    setActiveIndex((index) => index + 1);
  }

  return <View style={[styles.root, { paddingTop: insets.top, paddingBottom: Math.max(insets.bottom, spacing.md) }]}>
    <View accessibilityLabel={`Onboarding step ${activeIndex + 1} of ${stages.length}`} accessibilityRole="progressbar" accessibilityValue={{ min: 1, max: stages.length, now: activeIndex + 1 }} style={styles.progressTrack}>
      <Animated.View style={[styles.progressValue, progressStyle]} />
    </View>
    <View style={styles.presentation}>
      <View style={[styles.hero, { height: heroHeight }]}>
        {currentStage.kind === "mission" ? <View pointerEvents="none" style={StyleSheet.absoluteFill}>
          <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={styles.neuralBackdrop}>
            <NeuralBackdrop height={heroHeight} width={width - spacing.lg * 2} />
          </View>
          <LinearGradient colors={["rgba(3,5,7,0)", "rgba(3,5,7,0.96)"]} locations={[0.42, 1]} style={StyleSheet.absoluteFill} />
        </View> : <View accessibilityElementsHidden accessible={false} importantForAccessibility="no-hide-descendants" pointerEvents="none" style={styles.backdrop}><ChromeIcon glow={0.15} size={320} source={logoSource(currentStage, prefetchedLogoUrls)} /></View>}
        <View style={styles.logoArea}>
          {outgoingStage ? <Animated.View accessibilityElementsHidden accessible={false} importantForAccessibility="no-hide-descendants" pointerEvents="none" style={[styles.logo, outgoingStyle]}><ChromeIcon glow={0.72} size={176} source={logoSource(outgoingStage, prefetchedLogoUrls)} /></Animated.View> : null}
          <Animated.View style={[styles.logo, incomingStyle]}><ChromeIcon glow={0.72} size={176} source={logoSource(currentStage, prefetchedLogoUrls)} /></Animated.View>
        </View>
      </View>
      <View style={styles.sheet}>
        <View style={styles.separator}><SheetSeparator width={width} /></View>
        <Animated.Text accessibilityRole="header" style={[currentStage.kind === "mission" ? styles.wordmark : styles.title, titleStyle]}>{currentStage.kind === "mission" ? "VORINTHEX AI" : currentStage.app.name}</Animated.Text>
        <View style={styles.copy}>
          <Animated.Text style={[styles.description, descriptionStyle]}>{currentStage.kind === "mission" ? MISSION : currentStage.app.description}</Animated.Text>
        </View>
      </View>
    </View>
    <View style={styles.actions}><Button accessibilityLabel={isFinalStage ? "Try Core" : "Next onboarding stage"} onPress={next} size="md" style={styles.next} variant="primary">{isFinalStage ? "Try Core" : "Next"}</Button></View>
  </View>;
}

const styles = StyleSheet.create({
  root: { backgroundColor: palette.page, flex: 1, paddingHorizontal: spacing.lg },
  progressTrack: { backgroundColor: palette.hairline, borderRadius: 999, height: 2, marginTop: spacing.xs, overflow: "hidden" },
  progressValue: { backgroundColor: palette.silver100, height: 2 },
  presentation: { flex: 1, overflow: "hidden" },
  hero: { alignItems: "center", alignSelf: "center", overflow: "hidden", position: "relative", width: "100%" },
  neuralBackdrop: { inset: 0, opacity: 0.34, position: "absolute" },
  backdrop: { opacity: 0.09, position: "absolute", right: -90, top: -35 },
  logoArea: { height: 245, position: "relative", width: 204 },
  logo: { alignItems: "center", left: 14, position: "absolute", top: 0 },
  sheet: { alignItems: "center", flex: 1, marginHorizontal: -spacing.lg, paddingHorizontal: spacing.lg, shadowColor: "#000000", shadowOffset: { width: 0, height: -18 }, shadowOpacity: 0.72, shadowRadius: 30 },
  separator: { alignSelf: "stretch", height: 24, marginBottom: spacing.sm, marginHorizontal: -spacing.lg },
  copy: { alignItems: "center", flex: 1, justifyContent: "flex-end", maxWidth: 350, paddingBottom: spacing.xl * 2.5, paddingHorizontal: spacing.sm },
  wordmark: { color: palette.silver100, fontFamily: fonts.medium, fontSize: 15, letterSpacing: tracking.title, paddingLeft: tracking.title, textAlign: "center" },
  title: { color: palette.silver50, fontFamily: fonts.medium, fontSize: 34, lineHeight: 40, textAlign: "center" },
  description: { color: palette.silver300, fontFamily: fonts.regular, fontSize: 17, fontStyle: "italic", lineHeight: 27, textAlign: "center" },
  next: { width: "100%" },
  actions: { gap: spacing.sm },
});
