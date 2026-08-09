import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  AccessibilityInfo,
  Animated,
  Easing,
  KeyboardAvoidingView,
  Modal,
  PanResponder,
  Platform,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Button, type ButtonProps } from "../button/button.mobile";

export type BottomSheetProps = {
  children?: ReactNode;
  description?: string;
  onOpenChange: (open: boolean) => void;
  open: boolean;
  tall?: boolean;
  title: string;
};

export function BottomSheet({
  children,
  description,
  onOpenChange,
  open,
  tall = false,
  title,
}: BottomSheetProps) {
  const insets = useSafeAreaInsets();
  const [visible, setVisible] = useState(open);
  const [reducedMotion, setReducedMotion] = useState(false);
  const translateY = useRef(new Animated.Value(480)).current;
  const overlayOpacity = useRef(new Animated.Value(0)).current;
  const openRef = useRef(open);
  const onOpenChangeRef = useRef(onOpenChange);
  const reducedMotionRef = useRef(reducedMotion);
  openRef.current = open;
  onOpenChangeRef.current = onOpenChange;
  reducedMotionRef.current = reducedMotion;

  const animate = (show: boolean) => {
    translateY.stopAnimation();
    overlayOpacity.stopAnimation();
    const duration = reducedMotionRef.current ? 0 : show ? 320 : 220;
    Animated.parallel([
      Animated.timing(translateY, {
        duration,
        easing: show ? Easing.out(Easing.cubic) : Easing.in(Easing.cubic),
        toValue: show ? 0 : 480,
        useNativeDriver: true,
      }),
      Animated.timing(overlayOpacity, {
        duration,
        easing: Easing.linear,
        toValue: show ? 1 : 0,
        useNativeDriver: true,
      }),
    ]).start(({ finished }) => {
      if (finished && !show && !openRef.current) setVisible(false);
    });
  };

  useEffect(() => {
    let mounted = true;
    void AccessibilityInfo.isReduceMotionEnabled().then((enabled) => {
      if (mounted) setReducedMotion(enabled);
    });
    const subscription = AccessibilityInfo.addEventListener(
      "reduceMotionChanged",
      setReducedMotion,
    );
    return () => {
      mounted = false;
      subscription.remove();
    };
  }, []);

  useEffect(() => {
    if (open) {
      setVisible(true);
      translateY.setValue(reducedMotionRef.current ? 0 : 480);
      overlayOpacity.setValue(reducedMotionRef.current ? 1 : 0);
      animate(true);
    } else if (visible) {
      animate(false);
    }
    // Animated values are stable refs; visibility is intentionally driven by open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const panResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, gesture) =>
        gesture.dy > 4 && Math.abs(gesture.dy) > Math.abs(gesture.dx),
      onPanResponderMove: (_, gesture) =>
        translateY.setValue(Math.max(0, gesture.dy)),
      onPanResponderRelease: (_, gesture) => {
        if (gesture.dy >= 96 || gesture.vy >= 0.65) {
          onOpenChangeRef.current(false);
        } else {
          animate(true);
        }
      },
      onPanResponderTerminate: () => animate(true),
    }),
  ).current;

  if (!visible) return null;

  return (
    <Modal
      accessibilityViewIsModal
      animationType="none"
      onRequestClose={() => onOpenChange(false)}
      statusBarTranslucent
      transparent
      visible
    >
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} style={styles.root}>
        <Animated.View style={[styles.overlay, { opacity: overlayOpacity }]}>
          <Button
            accessibilityLabel="Close bottom sheet"
            contentMode="raw"
            onPress={() => onOpenChange(false)}
            style={StyleSheet.absoluteFill}
            variant="ghost"
          />
        </Animated.View>
        <Animated.View
          accessibilityLabel={[title, description].filter(Boolean).join(". ")}
          accessibilityRole="summary"
          style={[
            styles.sheet,
            tall && styles.tallSheet,
            {
              paddingBottom: Math.max(insets.bottom, 16),
              transform: [{ translateY }],
            },
          ]}
        >
          <View style={styles.dragTarget} {...panResponder.panHandlers}>
            <View style={styles.dragHandle} />
          </View>
          <View style={styles.header}>
            <Text accessibilityRole="header" style={styles.title}>
              {title}
            </Text>
            {description ? (
              <Text style={styles.description}>{description}</Text>
            ) : null}
          </View>
          <View style={[styles.content, tall && styles.tallContent]}>{children}</View>
        </Animated.View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

export type BottomSheetItemProps = ButtonProps;

export function BottomSheetItem({
  size = "lg",
  style,
  variant = "ghost",
  ...props
}: BottomSheetItemProps) {
  return (
    <Button
      size={size}
      style={(state) => [
        styles.item,
        typeof style === "function" ? style(state) : style,
      ]}
      variant={variant}
      {...props}
    />
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, justifyContent: "flex-end" },
  overlay: {
    backgroundColor: "rgba(3, 5, 7, 0.72)",
    bottom: 0,
    left: 0,
    position: "absolute",
    right: 0,
    top: 0,
  },
  sheet: {
    backgroundColor: "#0D1117",
    borderColor: "rgba(221, 226, 229, 0.14)",
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderWidth: 1,
    maxHeight: "90%",
    paddingHorizontal: 20,
  },
  tallSheet: { height: "72%" },
  dragTarget: { alignItems: "center", paddingBottom: 14, paddingTop: 12 },
  dragHandle: {
    backgroundColor: "#7B858C",
    borderRadius: 999,
    height: 4,
    opacity: 0.75,
    width: 42,
  },
  header: { gap: 6, paddingBottom: 18, paddingHorizontal: 4 },
  title: {
    color: "#F5F7F8",
    fontFamily: "Geist_600SemiBold",
    fontSize: 20,
    lineHeight: 26,
  },
  description: {
    color: "#7B858C",
    fontFamily: "Geist_400Regular",
    fontSize: 14,
    lineHeight: 20,
  },
  content: { gap: 6 },
  tallContent: { flex: 1 },
  item: { justifyContent: "flex-start", width: "100%" },
});
