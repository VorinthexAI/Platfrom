import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  AccessibilityInfo,
  Animated,
  BackHandler,
  Keyboard,
  PanResponder,
  Platform,
  StyleSheet,
  Text,
  TextInput as NativeTextInput,
  View,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Svg, { Defs, LinearGradient, Stop, Text as SvgText } from "react-native-svg";

import { Button } from "../button/button.mobile";
import { TextInput } from "../text-input/text-input.mobile";
import { CloseIcon } from "../../icons/close/close.mobile";
import { colors, spacing } from "../../tokens";

export type CoreComposerProps = {
  accessibilityHint?: string;
  accessibilityLabel: string;
  disabled?: boolean;
  editable?: boolean;
  leading: ReactNode;
  leadingAccessibilityLabel?: string;
  leadingDisabled?: boolean;
  loading?: boolean;
  maxLength?: number;
  message?: ReactNode;
  onChangeText: (value: string) => void;
  onFocusChange?: (focused: boolean) => void;
  onLeadingPress?: () => void;
  onSubmit: () => void;
  openRequest?: number;
  prompts: readonly string[];
  sendIcon: ReactNode;
  style?: StyleProp<ViewStyle>;
  value: string;
};

function useReducedMotion() {
  const [reducedMotion, setReducedMotion] = useState(true);

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

  return reducedMotion;
}

function RotatingPrompt({ prompts }: { prompts: readonly string[] }) {
  const reducedMotion = useReducedMotion();
  const [index, setIndex] = useState(0);
  const [opacity] = useState(() => new Animated.Value(1));
  const [translateY] = useState(() => new Animated.Value(0));
  const gradientId = useId().replaceAll(":", "");

  useEffect(() => {
    if (prompts.length < 2 || reducedMotion) return;
    const interval = setInterval(() => {
      Animated.parallel([
        Animated.timing(opacity, {
          duration: 220,
          toValue: 0,
          useNativeDriver: true,
        }),
        Animated.timing(translateY, {
          duration: 220,
          toValue: -4,
          useNativeDriver: true,
        }),
      ]).start(({ finished }) => {
        if (!finished) return;
        setIndex((current) => (current + 1) % prompts.length);
        translateY.setValue(4);
        Animated.parallel([
          Animated.timing(opacity, {
            duration: 280,
            toValue: 1,
            useNativeDriver: true,
          }),
          Animated.timing(translateY, {
            duration: 280,
            toValue: 0,
            useNativeDriver: true,
          }),
        ]).start();
      });
    }, 3_000);
    return () => {
      clearInterval(interval);
      opacity.stopAnimation();
      translateY.stopAnimation();
    };
  }, [opacity, prompts.length, reducedMotion, translateY]);

  const currentPrompt = prompts[index % Math.max(prompts.length, 1)] ?? "Ask Core anything";
  const prompt = `${currentPrompt.replace(/\.{3}$/, "")}...`;
  return (
    <Animated.View
      pointerEvents="none"
      style={[styles.prompt, { opacity, transform: [{ translateY }] }]}
    >
      <Svg height="38" width="100%">
        <Defs>
          <LinearGradient id={gradientId} x1="0" x2="1" y1="0" y2="0">
            <Stop offset="0" stopColor="#F5F7F8" />
            <Stop offset="0.46" stopColor="#9EA8B0" />
            <Stop offset="1" stopColor="#56616B" />
          </LinearGradient>
        </Defs>
        <SvgText
          fill={`url(#${gradientId})`}
          fontFamily="Geist_400Regular"
          fontSize="13"
          x="0"
          y="26"
        >
          {prompt}
        </SvgText>
      </Svg>
    </Animated.View>
  );
}

export function CoreComposer({
  accessibilityHint,
  accessibilityLabel,
  disabled = false,
  editable = true,
  leading,
  leadingAccessibilityLabel,
  leadingDisabled = false,
  loading = false,
  maxLength,
  message,
  onChangeText,
  onFocusChange,
  onLeadingPress,
  onSubmit,
  openRequest = 0,
  prompts,
  sendIcon,
  style,
  value,
}: CoreComposerProps) {
  const insets = useSafeAreaInsets();
  const [sheetOpen, setSheetOpen] = useState(false);
  const [keyboardVisible, setKeyboardVisible] = useState(false);
  const [inputHeight, setInputHeight] = useState(38);
  const [sheetTranslateY] = useState(() => new Animated.Value(0));
  const inputRef = useRef<NativeTextInput>(null);
  const onFocusChangeRef = useRef(onFocusChange);
  onFocusChangeRef.current = onFocusChange;
  const showPrompt = value.length === 0;

  const closeSheet = useCallback(() => {
    Keyboard.dismiss();
    inputRef.current?.blur();
    sheetTranslateY.setValue(0);
    setSheetOpen(false);
    onFocusChange?.(false);
  }, [onFocusChange, sheetTranslateY]);

  useEffect(() => {
    const showEvent = Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow";
    const hideEvent = Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide";
    const showSubscription = Keyboard.addListener(showEvent, () => setKeyboardVisible(true));
    const hideSubscription = Keyboard.addListener(hideEvent, () => setKeyboardVisible(false));
    return () => {
      showSubscription.remove();
      hideSubscription.remove();
    };
  }, []);

  useEffect(() => {
    if (!sheetOpen || Platform.OS !== "android") return;
    const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
      if (keyboardVisible) Keyboard.dismiss();
      return true;
    });
    return () => subscription.remove();
  }, [keyboardVisible, sheetOpen]);

  function openSheet() {
    if (sheetOpen) return;
    setSheetOpen(true);
    onFocusChangeRef.current?.(true);
  }

  useEffect(() => {
    if (openRequest <= 0) return;
    setSheetOpen(true);
    onFocusChange?.(true);
    const frame = requestAnimationFrame(() => inputRef.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [openRequest]);

  // Responder callbacks run only after gestures; the compiler otherwise treats the captured input ref as a render read.
  // eslint-disable-next-line react-hooks/refs
  const [panResponder] = useState(() => PanResponder.create({
    onMoveShouldSetPanResponder: (_, gesture) => gesture.dy > 8 && Math.abs(gesture.dy) > Math.abs(gesture.dx) * 1.2,
    onMoveShouldSetPanResponderCapture: (_, gesture) => gesture.dy > 8 && Math.abs(gesture.dy) > Math.abs(gesture.dx) * 1.2,
    onPanResponderMove: (_, gesture) => sheetTranslateY.setValue(Math.max(0, gesture.dy)),
    onPanResponderRelease: (_, gesture) => {
      const projectedDistance = gesture.dy + Math.max(0, gesture.vy) * 140;
      if (projectedDistance >= 88) closeSheet();
      else Animated.spring(sheetTranslateY, { toValue: 0, useNativeDriver: true }).start();
    },
    onPanResponderTerminate: () => Animated.spring(sheetTranslateY, { toValue: 0, useNativeDriver: true }).start(),
  }));

  function submit() {
    if (!disabled && editable && value.trim()) onSubmit();
  }

  return (
    <View pointerEvents="box-none" style={styles.layer}>
      {sheetOpen ? <View pointerEvents="none" style={styles.backdrop} /> : null}
      <Animated.View
        pointerEvents="box-none"
        style={[
          styles.wrap,
          style,
          sheetOpen && styles.sheet,
          {
            bottom: keyboardVisible ? 0 : insets.bottom + 12,
            ...(sheetOpen ? { top: insets.top, transform: [{ translateY: sheetTranslateY }] } : {}),
          },
        ]}
      >
        {sheetOpen ? (
          <View style={styles.sheetHeader} {...panResponder.panHandlers}>
            <View style={styles.dragTarget}>
              <View style={styles.dragHandle} />
            </View>
            <Text accessibilityRole="header" style={styles.sheetTitle}>Core</Text>
            <Button
              accessibilityLabel="Close Core"
              contentMode="raw"
              onPress={closeSheet}
              size="sm"
              style={styles.closeButton}
              variant="icon"
            >
              <CloseIcon size="sm" />
            </Button>
          </View>
        ) : null}
        <View style={styles.sheetBody}>
          {sheetOpen ? message : null}
          <View style={[styles.composer, sheetOpen && styles.composerOpen]}>
          {onLeadingPress ? (
            <Button
              accessibilityLabel={leadingAccessibilityLabel ?? "Core actions"}
              contentMode="raw"
              disabled={leadingDisabled}
              onPress={onLeadingPress}
              size="sm"
              variant="icon"
            >
              {leading}
            </Button>
          ) : (
            <View style={styles.leading}>{leading}</View>
          )}
          <View style={styles.inputArea}>
            {showPrompt ? (
              <View
                accessibilityElementsHidden
                importantForAccessibility="no-hide-descendants"
                pointerEvents="none"
                style={styles.prompt}
              >
                <RotatingPrompt prompts={prompts} />
              </View>
            ) : null}
            <TextInput
              accessibilityHint={accessibilityHint}
              accessibilityLabel={accessibilityLabel}
              editable={editable}
              maxLength={maxLength}
              multiline
              onChangeText={onChangeText}
              onContentSizeChange={({ nativeEvent }) => setInputHeight(Math.min(120, Math.max(38, nativeEvent.contentSize.height)))}
              onFocus={openSheet}
              onSubmitEditing={submit}
              placeholder=""
              ref={inputRef}
              returnKeyType={sheetOpen ? "default" : "send"}
              scrollEnabled={inputHeight >= 120}
              style={[styles.input, { height: inputHeight }]}
              textAlignVertical={inputHeight > 38 ? "top" : "center"}
              value={value}
            />
          </View>
          <Button
            accessibilityLabel="Send to Core"
            contentMode="raw"
            disabled={disabled || !value.trim()}
            loading={loading}
            onPress={submit}
            size="sm"
            variant="primary"
          >
            {sendIcon}
          </Button>
          </View>
        </View>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  layer: {
    bottom: 0,
    left: 0,
    position: "absolute",
    right: 0,
    top: 0,
    zIndex: 20,
  },
  backdrop: {
    bottom: 0,
    backgroundColor: "rgba(3, 5, 7, 0.72)",
    borderRadius: 0,
    left: 0,
    position: "absolute",
    right: 0,
    top: 0,
  },
  wrap: {
    gap: 6,
    left: spacing.md,
    position: "absolute",
    right: spacing.md,
  },
  sheet: {
    backgroundColor: colors.page,
    borderColor: colors.border,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderWidth: 1,
    borderBottomWidth: 0,
    left: 0,
    paddingBottom: spacing.md,
    paddingHorizontal: spacing.md,
    right: 0,
  },
  sheetHeader: {
    minHeight: 86,
    marginHorizontal: -spacing.md,
    paddingHorizontal: 20,
    position: "relative",
  },
  dragTarget: {
    alignItems: "center",
    minHeight: 36,
    paddingBottom: 14,
    paddingTop: 12,
  },
  dragHandle: {
    backgroundColor: colors.muted,
    borderRadius: 999,
    height: 4,
    opacity: 0.75,
    width: 42,
  },
  sheetTitle: {
    color: colors.text,
    fontFamily: "Geist_600SemiBold",
    fontSize: 20,
    lineHeight: 26,
    paddingHorizontal: 4,
  },
  closeButton: {
    position: "absolute",
    right: 20,
    top: 20,
    zIndex: 1,
  },
  sheetBody: {
    flex: 1,
    gap: 6,
    justifyContent: "flex-end",
  },
  composer: {
    alignItems: "center",
    backgroundColor: "#0B0F14",
    borderColor: colors.border,
    borderRadius: 999,
    borderWidth: 1,
    elevation: 10,
    flexDirection: "row",
    gap: 7,
    minHeight: 58,
    padding: 7,
    shadowColor: colors.page,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.45,
    shadowRadius: 18,
  },
  composerOpen: {
    borderColor: "#55616C",
    borderRadius: 24,
    shadowOpacity: 0.7,
  },
  leading: {
    alignItems: "center",
    height: 34,
    justifyContent: "center",
    width: 34,
  },
  inputArea: {
    flex: 1,
    justifyContent: "center",
    minHeight: 38,
  },
  prompt: {
    bottom: 0,
    left: 0,
    position: "absolute",
    right: 0,
    top: 0,
  },
  input: {
    backgroundColor: "transparent",
    borderWidth: 0,
    flex: 1,
    fontSize: 13,
    minHeight: 38,
    paddingHorizontal: 0,
  },
});
