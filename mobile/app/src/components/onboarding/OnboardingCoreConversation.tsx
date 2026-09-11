import { Button } from "@vorinthex/shared/ui/button";
import { ChromeIcon } from "@vorinthex/shared/ui/chrome-icon";
import { LoadingText } from "@vorinthex/shared/ui/loading-text";
import { RichText } from "@vorinthex/shared/ui/rich-text";
import * as ImagePicker from "expo-image-picker";
import * as Notifications from "expo-notifications";
import { useEffect, useMemo, useRef, useState } from "react";
import { AccessibilityInfo, Platform, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { assistantIconSource, vorinthexMarkSource } from "@/data/capability-icons";
import type { ServerApp } from "@/lib/apps-registry";
import { recordOnboardingEvent, type OnboardingEventSlug } from "@/lib/onboarding-events";
import { syncPushSubscription } from "@/lib/push-notifications";
import { fonts, palette, spacing } from "@/theme/tokens";

import { OnboardingAppPreview } from "./OnboardingIntroSequence";
import { selectOnboardingAppStages, type OnboardingAppSlug, type OnboardingAppStage } from "./onboarding-stages";

type PermissionStep = "photos" | "camera" | "notifications";
type ConversationStep =
  | { kind: "welcome" }
  | { kind: "app"; app: OnboardingAppStage }
  | { kind: "permission"; permission: PermissionStep }
  | { kind: "finish" };
type Message = { key: string; role: "assistant" | "user"; text: string };

const APP_COPY: Record<OnboardingAppSlug, string> = {
  "vorinthex-ai": "Vorinthex AI brings connected AI apps together so they can share context, learn together, and make every part of your digital life more intelligent.",
  archive: "Archive gives your documents, notes, and knowledge one connected home that Core can understand and use.",
  gallery: "Gallery makes your photo library searchable and useful with visual understanding, places, people, and memories.",
  compass: "Compass turns ideas and places into plans, keeping trips and the context around them together.",
  signal: "Signal is your private inbox for connected email and communication from Vorinthex apps and support.",
  ascend: "Ascend helps you learn and grow with books, audio, and knowledge shaped around you.",
  core: "Core connects every app. It carries context between them and stays available from the bottom of your screen whenever you need it.",
};

const PERMISSION_COPY: Record<PermissionStep, string> = {
  photos: "Allow access to your phone's photo library to start managing your images smartly with Gallery.",
  camera: "Allow camera access to scan documents and capture photos directly into Vorinthex AI.",
  notifications: "Allow notifications so you never miss anything. Signal can let you know when important connected email, Vorinthex app communication, or support replies arrive.",
};

function stepMessage(step: ConversationStep) {
  if (step.kind === "welcome") return "Welcome to Vorinthex AI. I'm Core, your personal AI agent. Chat with me like any AI assistant, ask me to generate images, or let me work across your apps and carry context between them. I'm always accessible at the bottom of the screen. Let me show you around.";
  if (step.kind === "app") return APP_COPY[step.app.slug];
  if (step.kind === "permission") return PERMISSION_COPY[step.permission];
  return "That's everything I need. Create your free account.";
}

function eventForStep(step: ConversationStep): OnboardingEventSlug {
  if (step.kind === "welcome") return "onboarding.welcome";
  if (step.kind === "app") return `onboarding.${step.app.slug}`;
  if (step.kind === "permission") return `onboarding.${step.permission}`;
  return "onboarding.sign-in";
}

export function OnboardingCoreConversation({ apps, onFinished }: { apps: readonly ServerApp[]; onFinished: () => void }) {
  const insets = useSafeAreaInsets();
  const scrollRef = useRef<ScrollView>(null);
  const keyRef = useRef(0);
  const actionLocked = useRef(false);
  const previewClosing = useRef(false);
  const steps = useMemo<ConversationStep[]>(() => [
    { kind: "welcome" },
    ...selectOnboardingAppStages(apps).map((app) => ({ kind: "app" as const, app })),
    { kind: "permission", permission: "photos" },
    { kind: "permission", permission: "camera" },
    { kind: "permission", permission: "notifications" },
    { kind: "finish" },
  ], [apps]);
  const [index, setIndex] = useState(0);
  const [messages, setMessages] = useState<Message[]>([]);
  const [thinking, setThinking] = useState(true);
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<OnboardingAppStage>();
  const step = steps[index] ?? steps[steps.length - 1]!;

  useEffect(() => {
    const event = eventForStep(step);
    void recordOnboardingEvent(event).catch(() => undefined);
    const timer = setTimeout(() => {
      const text = stepMessage(step);
      setMessages((current) => [...current, { key: `assistant-${keyRef.current++}`, role: "assistant", text }]);
      setThinking(false);
      actionLocked.current = false;
      previewClosing.current = false;
      AccessibilityInfo.announceForAccessibility(text);
      requestAnimationFrame(() => scrollRef.current?.scrollToEnd({ animated: true }));
    }, 1_000 + (index % 3) * 250);
    return () => clearTimeout(timer);
  }, [index, step]);

  function addUserMessage(text: string) {
    setMessages((current) => [...current, { key: `user-${keyRef.current++}`, role: "user", text }]);
    requestAnimationFrame(() => scrollRef.current?.scrollToEnd({ animated: true }));
  }

  function advance() {
    setThinking(true);
    setIndex((current) => Math.min(current + 1, steps.length - 1));
  }

  function beginAction() {
    if (actionLocked.current) return false;
    actionLocked.current = true;
    return true;
  }

  function explore(app: OnboardingAppStage) {
    if (!beginAction()) return;
    addUserMessage(`Explore ${app.name}`);
    setPreview(app);
  }

  function skipApp(app: OnboardingAppStage) {
    if (!beginAction()) return;
    addUserMessage(`Skip ${app.name}`);
    advance();
  }

  function finishPreview() {
    if (previewClosing.current) return;
    previewClosing.current = true;
    setPreview(undefined);
    advance();
  }

  async function handlePermission(permission: PermissionStep, allow: boolean) {
    if (busy || !beginAction()) return;
    addUserMessage(allow ? "Allow" : "Skip for now");
    setBusy(true);
    let allowed = false;
    try {
      if (permission === "photos") {
        if (allow) allowed = (await ImagePicker.requestMediaLibraryPermissionsAsync()).granted;
      } else if (permission === "camera" && allow) {
        allowed = (await ImagePicker.requestCameraPermissionsAsync()).granted;
      } else if (permission === "notifications" && allow) {
        if (Platform.OS === "android") await Notifications.setNotificationChannelAsync("default", { importance: Notifications.AndroidImportance.DEFAULT, name: "Notifications" });
        const result = await Notifications.requestPermissionsAsync({ ios: { allowAlert: true, allowBadge: true, allowSound: true } });
        allowed = result.granted;
        if (allowed) await syncPushSubscription().catch(() => undefined);
      }
    } catch {
      // Permission request failures follow the same analytics path as skipped access.
    } finally {
      void recordOnboardingEvent(`onboarding.${permission}.${allowed ? "allowed" : "skipped"}`).catch(() => undefined);
      setBusy(false);
      advance();
    }
  }

  if (preview) return <OnboardingAppPreview app={preview.slug === "signal" ? { ...preview, description: APP_COPY.signal } : preview} onFinished={finishPreview} />;

  return <View style={[styles.root, { paddingTop: Math.max(insets.top, spacing.md), paddingBottom: Math.max(insets.bottom, spacing.md) }]}>
    <View style={styles.header}>
      <ChromeIcon glow={0.55} size={44} source={index === 0 ? vorinthexMarkSource : assistantIconSource} />
      <View style={styles.headerCopy}><Text accessibilityRole="header" style={styles.title}>Your guide to Vorinthex AI</Text></View>
      <Text accessibilityLabel={`Step ${index + 1} of ${steps.length}`} style={styles.count}>{index + 1}/{steps.length}</Text>
    </View>
    <ScrollView contentContainerStyle={styles.conversation} onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: false })} ref={scrollRef} showsVerticalScrollIndicator={false}>
      {messages.map((message) => message.role === "assistant"
        ? <View key={message.key} style={[styles.messageRow, styles.assistantRow]}><ChromeIcon glow={0.35} size={20} source={assistantIconSource} style={styles.assistantMark} /><View style={[styles.messageContent, styles.assistantMessage]}><RichText content={message.text} /></View></View>
        : <View key={message.key} style={[styles.messageRow, styles.userRow]}><View style={[styles.messageContent, styles.userMessage]}><RichText content={message.text} /></View></View>)}
      {thinking ? <View style={[styles.messageRow, styles.assistantRow]}><ChromeIcon glow={0.35} size={20} source={assistantIconSource} style={styles.assistantMark} /><LoadingText style={styles.loading} text="Thinking..." /></View> : null}
    </ScrollView>
    {!thinking ? <View style={styles.actions}>
      {step.kind === "welcome" ? <Button onPress={() => { if (!beginAction()) return; addUserMessage("Show me around"); advance(); }} size="md" variant="primary">Show me around</Button> : null}
      {step.kind === "app" ? <><Button onPress={() => explore(step.app)} size="md" variant="primary">Explore</Button><Button onPress={() => skipApp(step.app)} size="md" variant="secondary">Skip</Button></> : null}
      {step.kind === "permission" ? <><Button disabled={busy} onPress={() => void handlePermission(step.permission, true)} size="md" variant="primary">Allow</Button><Button disabled={busy} onPress={() => void handlePermission(step.permission, false)} size="md" variant="secondary">Skip</Button></> : null}
      {step.kind === "finish" ? <Button onPress={() => { if (beginAction()) onFinished(); }} size="md" variant="primary">Get started</Button> : null}
    </View> : null}
  </View>;
}

const styles = StyleSheet.create({
  root: { backgroundColor: palette.page, flex: 1, paddingHorizontal: spacing.lg },
  header: { alignItems: "center", flexDirection: "row", gap: spacing.sm, paddingBottom: spacing.sm },
  headerCopy: { flex: 1, minWidth: 0 },
  title: { color: palette.silver50, fontFamily: fonts.medium, fontSize: 17, lineHeight: 23 },
  count: { color: palette.silver300, fontFamily: fonts.medium, fontSize: 13 },
  conversation: { flexGrow: 1, gap: spacing.lg, paddingBottom: spacing.lg, paddingTop: spacing.xl },
  messageRow: { alignItems: "flex-start", flexDirection: "row", width: "100%" },
  assistantRow: { gap: spacing.sm, justifyContent: "flex-start", paddingRight: spacing.lg },
  userRow: { justifyContent: "flex-end", paddingLeft: 52 },
  assistantMark: { marginTop: 4 },
  messageContent: { gap: spacing.xs, minWidth: 0 },
  assistantMessage: { backgroundColor: "transparent", flex: 1, minWidth: 0 },
  userMessage: { backgroundColor: "transparent" },
  loading: { flex: 1, marginTop: 3 },
  actions: { gap: spacing.xs, paddingTop: spacing.sm },
});
