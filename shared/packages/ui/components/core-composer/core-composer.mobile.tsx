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
  Keyboard,
  StyleSheet,
  Text,
  TextInput as NativeTextInput,
  View,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Reanimated, { useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";
import Svg, { Defs, LinearGradient, Stop, Text as SvgText } from "react-native-svg";

import { Button } from "../button/button.mobile";
import { BottomSheet } from "../bottom-sheet/bottom-sheet.mobile";
import { TextInput } from "../text-input/text-input.mobile";
import { useKeyboard } from "../../hooks/use-keyboard.mobile";
import { colors, spacing } from "../../tokens";

export type CoreComposerProps = {
  accessory?: ReactNode;
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

const COLLAPSED_INPUT_HEIGHT = 38;
const INPUT_LINE_HEIGHT = 18;
const INPUT_VERTICAL_PADDING = 10;
const MAX_INPUT_HEIGHT = INPUT_LINE_HEIGHT * 6 + INPUT_VERTICAL_PADDING * 2;

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
          y="25"
        >
          {prompt}
        </SvgText>
      </Svg>
    </Animated.View>
  );
}

export function CoreComposer({
  accessory,
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
  const keyboardVisible = useKeyboard();
  const [sheetOpen, setSheetOpen] = useState(false);
  const [inputHeight, setInputHeight] = useState(COLLAPSED_INPUT_HEIGHT);
  const [inputSelection, setInputSelection] = useState<{ start: number; end: number }>();
  const inputRef = useRef<NativeTextInput>(null);
  const intentionalFocus = useRef(false);
  const onFocusChangeRef = useRef(onFocusChange);
  onFocusChangeRef.current = onFocusChange;
  const showPrompt = value.length === 0;
  const keyboardSpacerHeight = useSharedValue(0);
  const keyboardSpacerStyle = useAnimatedStyle(() => ({ height: keyboardSpacerHeight.value }));

  useEffect(() => {
    keyboardSpacerHeight.value = withTiming(keyboardVisible ? 300 : 0, { duration: 300 });
  }, [keyboardSpacerHeight, keyboardVisible]);

  const closeSheet = useCallback(() => {
    Keyboard.dismiss();
    inputRef.current?.blur();
    intentionalFocus.current = false;
    setSheetOpen(false);
    setInputHeight(COLLAPSED_INPUT_HEIGHT);
    setInputSelection(undefined);
    onFocusChange?.(false);
  }, [onFocusChange]);

  function openSheet() {
    if (sheetOpen) return;
    setInputHeight(COLLAPSED_INPUT_HEIGHT);
    setInputSelection({ start: 0, end: 0 });
    onFocusChangeRef.current?.(true);
    setSheetOpen(true);
  }

  useEffect(() => {
    if (openRequest <= 0) return;
    setInputHeight(COLLAPSED_INPUT_HEIGHT);
    setInputSelection({ start: 0, end: 0 });
    onFocusChange?.(true);
    setSheetOpen(true);
  }, [openRequest]);

  useEffect(() => {
    if (!sheetOpen) return;
    let selectionReleaseTimeout: ReturnType<typeof setTimeout> | undefined;
    const focusTimeout = setTimeout(() => {
      inputRef.current?.focus();
      selectionReleaseTimeout = setTimeout(() => setInputSelection(undefined), 300);
    }, 300);
    return () => {
      clearTimeout(focusTimeout);
      if (selectionReleaseTimeout) clearTimeout(selectionReleaseTimeout);
    };
  }, [sheetOpen]);

  useEffect(() => {
    if (value.length !== 0) return;
    const timeout = setTimeout(() => setInputHeight(COLLAPSED_INPUT_HEIGHT), 0);
    return () => clearTimeout(timeout);
  }, [value]);

  function submit() {
    if (!disabled && editable && value.trim()) onSubmit();
  }

  const composer = (expanded: boolean) => {
    const multiline = expanded && inputHeight > COLLAPSED_INPUT_HEIGHT;
    return <View style={[styles.composer, expanded && styles.composerOpen]}>
    {onLeadingPress ? (
      <Button
        accessibilityLabel={leadingAccessibilityLabel ?? "Core actions"}
        contentMode="raw"
        disabled={leadingDisabled}
        onPress={onLeadingPress}
        size={expanded ? "md" : "sm"}
        style={multiline ? styles.leadingTop : undefined}
        variant="icon"
      >
        {leading}
      </Button>
    ) : (
      <View style={[styles.leading, multiline && styles.leadingTop]}>{leading}</View>
    )}
    <View style={[styles.inputArea, { height: expanded ? inputHeight : COLLAPSED_INPUT_HEIGHT }]}>
      {expanded && value.length > 0 ? <Text
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        onTextLayout={({ nativeEvent }) => {
          const lineCount = Math.min(6, Math.max(1, nativeEvent.lines.length));
          const nextHeight = INPUT_VERTICAL_PADDING * 2 + INPUT_LINE_HEIGHT * lineCount;
          setInputHeight((current) => current === nextHeight ? current : nextHeight);
        }}
        pointerEvents="none"
        style={styles.inputMeasure}
      >{`${value}\u200b`}</Text> : null}
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
        multiline={expanded}
        numberOfLines={expanded ? undefined : 1}
        onChangeText={(nextValue) => {
          if (expanded && nextValue.length === 0) setInputHeight(COLLAPSED_INPUT_HEIGHT);
          onChangeText(nextValue);
        }}
        onFocus={() => {
          if (expanded) return;
          if (intentionalFocus.current) {
            intentionalFocus.current = false;
            openSheet();
            return;
          }
          inputRef.current?.blur();
          Keyboard.dismiss();
        }}
        onPressIn={() => { if (!expanded) intentionalFocus.current = true; }}
        onSubmitEditing={submit}
        placeholder=""
        ref={inputRef}
        returnKeyType={expanded ? "default" : "send"}
        scrollEnabled={expanded && inputHeight >= MAX_INPUT_HEIGHT - 1}
        selection={expanded ? inputSelection : undefined}
        style={[styles.input, !multiline && styles.inputSingleLine]}
        textAlignVertical={multiline ? "top" : "center"}
        value={value}
      />
    </View>
    <Button
      accessibilityLabel="Send to Core"
      contentMode="raw"
      disabled={disabled || !value.trim()}
      loading={loading}
      onPress={submit}
      size={expanded ? "md" : "sm"}
      style={multiline ? styles.sendBottom : undefined}
      variant="primary"
    >
      {sendIcon}
    </Button>
  </View>;
  };

  return (
    <>
      <View pointerEvents="box-none" style={[styles.layer, {
        marginTop: spacing.sm,
        paddingBottom: Math.max(insets.bottom, spacing.sm),
        paddingLeft: Math.max(insets.left, spacing.md),
        paddingRight: Math.max(insets.right, spacing.md),
      }]}>
        {!sheetOpen ? <>{accessory}{composer(false)}</> : null}
      </View>
      <BottomSheet height="full" onOpenChange={(open) => { if (!open) closeSheet(); }} open={sheetOpen} title="Core">
        {sheetOpen ? <View style={[styles.sheetBodyOpen, style]}>
          {message}
          {composer(true)}
          <Reanimated.View pointerEvents="none" style={keyboardSpacerStyle} />
        </View> : null}
      </BottomSheet>
    </>
  );
}

const styles = StyleSheet.create({
  layer: {
    gap: 6,
    zIndex: 20,
  },
  sheetBodyOpen: {
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
  leadingTop: { alignSelf: "flex-start" },
  sendBottom: { alignSelf: "flex-end" },
  inputArea: {
    flex: 1,
    justifyContent: "center",
    maxHeight: MAX_INPUT_HEIGHT,
    minHeight: COLLAPSED_INPUT_HEIGHT,
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
    fontSize: 13,
    height: "100%",
    lineHeight: INPUT_LINE_HEIGHT,
    minHeight: 0,
    paddingHorizontal: 0,
    paddingVertical: INPUT_VERTICAL_PADDING,
    width: "100%",
  },
  inputSingleLine: { paddingVertical: 0 },
  inputMeasure: {
    fontFamily: "Geist_400Regular",
    fontSize: 13,
    left: 0,
    lineHeight: INPUT_LINE_HEIGHT,
    opacity: 0,
    paddingHorizontal: 0,
    paddingVertical: INPUT_VERTICAL_PADDING,
    position: "absolute",
    right: 0,
  },
});
