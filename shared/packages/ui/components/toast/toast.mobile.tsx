import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { AccessibilityInfo, Animated, Easing, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { colors, radii, spacing } from "../../tokens";

const DEFAULT_DURATION = 2_000;
const MAX_VISIBLE = 3;

export type ToastNotice = {
  title: string;
  description?: string;
  duration?: number;
};

type ToastRecord = ToastNotice & { id: number };
type ToastContextValue = {
  dismissToast: (id: number) => void;
  notices: ToastRecord[];
  showToast: (notice: ToastNotice) => number;
};

const ToastContext = createContext<ToastContextValue | undefined>(undefined);

function ToastCard({ depth, notice, onDismiss }: { depth: number; notice: ToastRecord; onDismiss: (id: number) => void }) {
  const progress = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(progress, {
      duration: 260,
      easing: Easing.bezier(0.16, 1, 0.3, 1),
      toValue: 1,
      useNativeDriver: true,
    }).start();
    const timeout = setTimeout(() => {
      Animated.timing(progress, {
        duration: 190,
        easing: Easing.in(Easing.cubic),
        toValue: 0,
        useNativeDriver: true,
      }).start(({ finished }) => { if (finished) onDismiss(notice.id); });
    }, notice.duration ?? DEFAULT_DURATION);
    return () => {
      clearTimeout(timeout);
      progress.stopAnimation();
    };
  }, [notice.description, notice.duration, notice.id, notice.title, onDismiss, progress]);

  return (
    <Animated.View
      accessibilityElementsHidden={depth > 0}
      accessibilityLiveRegion={depth === 0 ? "polite" : "none"}
      importantForAccessibility={depth === 0 ? "yes" : "no-hide-descendants"}
      pointerEvents="none"
      style={[
        styles.toast,
        {
          opacity: progress.interpolate({ inputRange: [0, 1], outputRange: [0, 1 - depth * 0.18] }),
          transform: [
            { perspective: 1_000 },
            { translateY: Animated.add(progress.interpolate({ inputRange: [0, 1], outputRange: [-12, 0] }), -depth * 9) },
            { scale: progress.interpolate({ inputRange: [0, 1], outputRange: [0.96, 1 - depth * 0.035] }) },
            { rotateX: `${depth * 0.8}deg` },
          ],
          zIndex: MAX_VISIBLE - depth,
        },
      ]}
    >
      <View style={styles.edge} />
      <View style={styles.copy}>
        <Text numberOfLines={1} style={styles.title}>{notice.title}</Text>
        {notice.description ? <Text numberOfLines={2} style={styles.description}>{notice.description}</Text> : null}
      </View>
    </Animated.View>
  );
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const nextId = useRef(0);
  const [notices, setNotices] = useState<ToastRecord[]>([]);
  const dismissToast = useCallback((id: number) => setNotices((current) => current.filter((notice) => notice.id !== id)), []);
  const showToast = useCallback((notice: ToastNotice) => {
    nextId.current += 1;
    const id = nextId.current;
    setNotices((current) => [{ ...notice, id }, ...current].slice(0, MAX_VISIBLE));
    AccessibilityInfo.announceForAccessibility([notice.title, notice.description].filter(Boolean).join(". "));
    return id;
  }, []);

  return (
    <ToastContext.Provider value={{ dismissToast, notices, showToast }}>
      {children}
      <ToastViewport />
    </ToastContext.Provider>
  );
}

export function ToastViewport() {
  const context = useContext(ToastContext);
  const insets = useSafeAreaInsets();
  if (!context) return null;
  return <View pointerEvents="box-none" style={[styles.viewport, { top: insets.top + spacing.sm }]}><View pointerEvents="none" style={styles.stack}>{context.notices.map((notice, depth) => <ToastCard depth={depth} key={notice.id} notice={notice} onDismiss={context.dismissToast} />)}</View></View>;
}

export function useToast() {
  const context = useContext(ToastContext);
  if (!context) throw new Error("useToast must be used within ToastProvider.");
  return context;
}

const styles = StyleSheet.create({
  viewport: { elevation: 1000, left: spacing.md, position: "absolute", right: spacing.md, zIndex: 1000 },
  stack: { height: 92, position: "relative" },
  toast: {
    alignSelf: "center",
    backgroundColor: colors.surface,
    borderColor: "rgba(221, 226, 229, 0.24)",
    borderRadius: radii.md,
    borderWidth: 1,
    elevation: 18,
    left: 0,
    minHeight: 72,
    overflow: "hidden",
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    position: "absolute",
    right: 0,
    shadowColor: "#000000",
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.55,
    shadowRadius: 20,
  },
  edge: { backgroundColor: "rgba(255, 255, 255, 0.42)", height: 1, left: spacing.md, position: "absolute", right: spacing.md, top: 0 },
  copy: { flex: 1, justifyContent: "center", gap: 3 },
  title: { color: colors.text, fontFamily: "Geist_600SemiBold", fontSize: 14, lineHeight: 20 },
  description: { color: colors.muted, fontFamily: "Geist_400Regular", fontSize: 12, lineHeight: 17 },
});
