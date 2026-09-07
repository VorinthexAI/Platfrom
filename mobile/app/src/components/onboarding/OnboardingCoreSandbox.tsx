import { Button } from "@vorinthex/shared/ui/button";
import { ChromeIcon } from "@vorinthex/shared/ui/chrome-icon";
import { LoadingText } from "@vorinthex/shared/ui/loading-text";
import { RichText } from "@vorinthex/shared/ui/rich-text";
import { useEffect, useRef, useState } from "react";
import { AccessibilityInfo, ScrollView, StyleSheet, Text, View } from "react-native";
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { assistantIconSource } from "@/data/capability-icons";
import { askOnboardingSandboxQuestion, createOnboardingSandboxSession, selectOnboardingSandboxPrompts, type OnboardingSandboxAnswer, type OnboardingSandboxPrompt, type OnboardingSandboxSession } from "@/lib/onboarding-sandbox-client";
import { easings } from "@/theme/motion";
import { fonts, palette, spacing, tracking } from "@/theme/tokens";

export function OnboardingCoreSandbox({ onFinished }: { onFinished: () => void }) {
  const insets = useSafeAreaInsets();
  const scrollRef = useRef<ScrollView>(null);
  const answerControllerRef = useRef<AbortController | undefined>(undefined);
  const [session, setSession] = useState<OnboardingSandboxSession>();
  const [prompts, setPrompts] = useState<OnboardingSandboxPrompt[]>([]);
  const [answers, setAnswers] = useState<OnboardingSandboxAnswer[]>([]);
  const [pendingPromptId, setPendingPromptId] = useState<string>();
  const [error, setError] = useState("");
  const progress = useSharedValue(0);

  useEffect(() => {
    const controller = new AbortController();
    void createOnboardingSandboxSession(controller.signal).then((created) => {
      setSession(created);
      setPrompts(selectOnboardingSandboxPrompts(created.prompts));
    }).catch(() => { if (!controller.signal.aborted) setError("Core could not start. Check your connection and try again."); });
    return () => { controller.abort(); answerControllerRef.current?.abort(); };
  }, []);

  useEffect(() => {
    if (answers.length) AccessibilityInfo.announceForAccessibility(`Question ${answers.length} of 3 answered`);
    progress.value = withTiming(answers.length / 3, { duration: 500, easing: easings.luxury });
  }, [answers.length, progress]);

  const ask = async (prompt: OnboardingSandboxPrompt) => {
    if (!session || pendingPromptId || answers.some(({ promptId }) => promptId === prompt.id)) return;
    setPendingPromptId(prompt.id);
    setError("");
    const controller = new AbortController();
    answerControllerRef.current = controller;
    requestAnimationFrame(() => scrollRef.current?.scrollToEnd({ animated: true }));
    try {
      const answer = await askOnboardingSandboxQuestion(session.token, prompt.id, controller.signal);
      setAnswers((current) => current.some(({ promptId }) => promptId === answer.promptId) ? current : [...current, answer]);
      requestAnimationFrame(() => scrollRef.current?.scrollToEnd({ animated: true }));
    } catch {
      if (!controller.signal.aborted) setError("Core could not answer that question. Please try again.");
    } finally {
      if (!controller.signal.aborted) setPendingPromptId(undefined);
    }
  };

  const completedIds = new Set(answers.map(({ promptId }) => promptId));
  const pendingPrompt = prompts.find(({ id }) => id === pendingPromptId);
  const progressStyle = useAnimatedStyle(() => ({ width: `${progress.value * 100}%` }));
  return <View style={[styles.root, { paddingTop: Math.max(insets.top, spacing.md), paddingBottom: Math.max(insets.bottom, spacing.md) }]}>
    <View style={styles.header}>
      <ChromeIcon glow={0.55} size={44} source={assistantIconSource} />
      <View style={styles.headerCopy}><Text style={styles.eyebrow}>CORE PREVIEW</Text><Text accessibilityRole="header" style={styles.title}>Ask 3 questions to continue</Text></View>
      <Text accessibilityLabel={`${answers.length} of 3 questions answered`} style={styles.count}>{answers.length}/3</Text>
    </View>
    <View accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: 3, now: answers.length }} style={styles.progressTrack}><Animated.View style={[styles.progressValue, progressStyle]} /></View>
    <ScrollView contentContainerStyle={styles.conversation} ref={scrollRef} showsVerticalScrollIndicator={false}>
      <View style={styles.assistantRow}><ChromeIcon glow={0.35} size={20} source={assistantIconSource} /><View style={styles.assistantMessage}><Text style={styles.introduction}>Try Core for yourself. Choose each question below to see how Vorinthex AI fits together.</Text></View></View>
      {answers.map((answer) => <View key={answer.promptId} style={styles.exchange}>
        <View style={styles.userRow}><Text style={styles.userText}>{answer.question}</Text></View>
        <View style={styles.assistantRow}><ChromeIcon glow={0.35} size={20} source={assistantIconSource} /><View style={styles.assistantMessage}><RichText content={answer.answer} /></View></View>
      </View>)}
      {pendingPrompt ? <View style={styles.exchange}>
        <View style={styles.userRow}><Text style={styles.userText}>{pendingPrompt.question}</Text></View>
        <View style={styles.assistantRow}><ChromeIcon glow={0.35} size={20} source={assistantIconSource} /><LoadingText style={styles.loading} text="Thinking..." /></View>
      </View> : null}
    </ScrollView>
    <View style={styles.actions}>
      {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
      {!session && error ? <Button onPress={() => { setError(""); void createOnboardingSandboxSession().then((created) => { setSession(created); setPrompts(selectOnboardingSandboxPrompts(created.prompts)); }).catch(() => setError("Core could not start. Check your connection and try again.")); }} size="md" variant="secondary">Retry Core preview</Button> : null}
      {prompts.filter((prompt) => !completedIds.has(prompt.id) && prompt.id !== pendingPromptId).map((prompt) => <Button disabled={!session || Boolean(pendingPromptId)} key={prompt.id} onPress={() => void ask(prompt)} size="md" variant="secondary">{prompt.label}</Button>)}
      {answers.length === 3 ? <Button accessibilityLabel="Get started with Vorinthex AI" onPress={onFinished} size="md" variant="primary">Get started</Button> : null}
    </View>
  </View>;
}

const styles = StyleSheet.create({
  root: { backgroundColor: palette.page, flex: 1, paddingHorizontal: spacing.lg },
  header: { alignItems: "center", flexDirection: "row", gap: spacing.sm, paddingBottom: spacing.sm },
  headerCopy: { flex: 1, minWidth: 0 },
  eyebrow: { color: palette.silver500, fontFamily: fonts.medium, fontSize: 10, letterSpacing: tracking.micro },
  title: { color: palette.silver50, fontFamily: fonts.medium, fontSize: 17, lineHeight: 23 },
  count: { color: palette.silver300, fontFamily: fonts.medium, fontSize: 13 },
  progressTrack: { backgroundColor: palette.hairline, borderRadius: 999, height: 2, overflow: "hidden" },
  progressValue: { backgroundColor: palette.silver100, height: 2 },
  conversation: { flexGrow: 1, gap: spacing.lg, paddingBottom: spacing.lg, paddingTop: spacing.xl },
  exchange: { gap: spacing.md },
  assistantRow: { alignItems: "flex-start", flexDirection: "row", gap: spacing.sm, paddingRight: spacing.lg },
  assistantMessage: { flex: 1, minWidth: 0 },
  introduction: { color: palette.silver300, fontFamily: fonts.regular, fontSize: 15, lineHeight: 23 },
  userRow: { alignItems: "flex-end", paddingLeft: 52 },
  userText: { color: palette.silver100, fontFamily: fonts.regular, fontSize: 14, lineHeight: 20, textAlign: "right" },
  loading: { flex: 1, transform: [{ translateY: -3 }] },
  actions: { gap: spacing.xs, paddingTop: spacing.sm },
  error: { color: palette.danger, fontFamily: fonts.regular, fontSize: 12, lineHeight: 17, textAlign: "center" },
});
