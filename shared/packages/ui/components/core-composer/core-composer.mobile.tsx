import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import {
  AccessibilityInfo,
  Animated,
  BackHandler,
  findNodeHandle,
  Keyboard,
  StyleSheet,
  Text,
  TextInput as NativeTextInput,
  View,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Reanimated, { KeyboardState, useAnimatedKeyboard, useAnimatedStyle } from "react-native-reanimated";
import Svg, { Defs, LinearGradient, Stop, Text as SvgText } from "react-native-svg";

import { Button } from "../button/button.mobile";
import { ChevronLeftIcon } from "../../icons/chevron-left/chevron-left.mobile";
import { TextInput } from "../text-input/text-input.mobile";
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
  pageIdentity: (closePage: () => void) => ReactNode;
  prompts: readonly string[];
  sendIcon: ReactNode;
  style?: StyleProp<ViewStyle>;
  value: string;
};

const COLLAPSED_INPUT_HEIGHT = 38;
const INPUT_LINE_HEIGHT = 18;
const INPUT_VERTICAL_PADDING = 10;
const MAX_INPUT_HEIGHT = INPUT_LINE_HEIGHT * 6 + INPUT_VERTICAL_PADDING * 2;
const CORE_FOCUS_DELAY_MS = 100;

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

type CorePageProps = {
  bottomInset: number;
  closePage: () => void;
  composer: ReactNode;
  inputRef: RefObject<NativeTextInput | null>;
  leftInset: number;
  message?: ReactNode;
  pageIdentity: (closePage: () => void) => ReactNode;
  releaseSelection: () => void;
  rightInset: number;
  style?: StyleProp<ViewStyle>;
  topInset: number;
};

function CorePage({ bottomInset, closePage, composer, inputRef, leftInset, message, pageIdentity, releaseSelection, rightInset, style, topInset }: CorePageProps) {
  const keyboard = useAnimatedKeyboard({
    isNavigationBarTranslucentAndroid: true,
    isStatusBarTranslucentAndroid: true,
  });
  const keyboardSpacerStyle = useAnimatedStyle(() => {
    const keyboardMoving = [KeyboardState.OPENING, KeyboardState.OPEN, KeyboardState.CLOSING].includes(keyboard.state.value);
    const keyboardLift = Math.max(0, keyboard.height.value - bottomInset);
    return { height: keyboardMoving ? keyboardLift + Math.min(spacing.md, keyboardLift) : 0 };
  }, [bottomInset]);

  useEffect(() => {
    let selectionFrame: number | undefined;
    const focusTimeout = setTimeout(() => {
      inputRef.current?.focus();
      selectionFrame = requestAnimationFrame(releaseSelection);
    }, CORE_FOCUS_DELAY_MS);
    return () => {
      clearTimeout(focusTimeout);
      if (selectionFrame !== undefined) cancelAnimationFrame(selectionFrame);
    };
  }, [inputRef, releaseSelection]);

  useEffect(() => BackHandler.addEventListener("hardwareBackPress", () => {
    closePage();
    return true;
  }).remove, [closePage]);

  return <View accessibilityLabel="Core" accessibilityViewIsModal onAccessibilityEscape={closePage} style={styles.page}>
    <View style={[styles.pageIdentityHeader, {
      paddingTop: topInset + 6,
      paddingLeft: Math.max(leftInset, spacing.md),
      paddingRight: Math.max(rightInset, spacing.md),
    }]}>{pageIdentity(closePage)}</View>
    <View style={[styles.pageContent, style, {
      paddingBottom: Math.max(bottomInset, spacing.sm),
      paddingLeft: Math.max(leftInset, spacing.md),
      paddingRight: Math.max(rightInset, spacing.md),
    }]}>
      <View style={styles.pageTitleRow}>
        <Button accessibilityLabel="Back from Core" contentMode="raw" onPress={closePage} size="xs" variant="icon"><ChevronLeftIcon size="sm" /></Button>
        <Text numberOfLines={1} style={styles.pageTitle}>Core</Text>
        <View style={styles.pageTitleSpacer} />
      </View>
      <View style={styles.pageConversation}>{message}</View>
      <View>
        {composer}
        <Reanimated.View pointerEvents="none" style={keyboardSpacerStyle} />
      </View>
    </View>
  </View>;
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
  pageIdentity,
  prompts,
  sendIcon,
  style,
  value,
}: CoreComposerProps) {
  const insets = useSafeAreaInsets();
  const [pageOpen, setPageOpen] = useState(false);
  const [inputHeight, setInputHeight] = useState(COLLAPSED_INPUT_HEIGHT);
  const [inputLineCount, setInputLineCount] = useState(1);
  const [inputSelection, setInputSelection] = useState<{ start: number; end: number }>();
  const closeFallbackRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const closeSubscriptionRef = useRef<{ remove: () => void } | undefined>(undefined);
  const closingRef = useRef(false);
  const inputRef = useRef<NativeTextInput>(null);
  const intentionalFocus = useRef(false);
  const onFocusChangeRef = useRef(onFocusChange);
  const pageWasOpenRef = useRef(false);
  const valueRef = useRef(value);
  onFocusChangeRef.current = onFocusChange;
  valueRef.current = value;
  const showPrompt = value.length === 0;

  const finishClose = useCallback(() => {
    if (!closingRef.current) return;
    closeSubscriptionRef.current?.remove();
    closeSubscriptionRef.current = undefined;
    if (closeFallbackRef.current) clearTimeout(closeFallbackRef.current);
    closeFallbackRef.current = undefined;
    closingRef.current = false;
    intentionalFocus.current = false;
    setPageOpen(false);
    setInputHeight(COLLAPSED_INPUT_HEIGHT);
    setInputLineCount(1);
    setInputSelection(undefined);
    onFocusChangeRef.current?.(false);
  }, []);

  const closePage = useCallback(() => {
    if (closingRef.current) return;
    closingRef.current = true;
    if (Keyboard.isVisible()) {
      closeSubscriptionRef.current = Keyboard.addListener("keyboardDidHide", finishClose);
      closeFallbackRef.current = setTimeout(finishClose, 500);
    }
    inputRef.current?.blur();
    Keyboard.dismiss();
    if (!Keyboard.isVisible()) finishClose();
  }, [finishClose]);

  const releaseInputSelection = useCallback(() => setInputSelection(undefined), []);

  const openPage = useCallback(() => {
    if (pageOpen) return;
    setInputHeight(COLLAPSED_INPUT_HEIGHT);
    setInputLineCount(1);
    setInputSelection({ start: valueRef.current.length, end: valueRef.current.length });
    onFocusChangeRef.current?.(true);
    setPageOpen(true);
  }, [pageOpen]);

  useEffect(() => {
    const pageWasOpen = pageWasOpenRef.current;
    pageWasOpenRef.current = pageOpen;
    if (!pageWasOpen || pageOpen) return;
    const timeout = setTimeout(() => {
      const inputHandle = findNodeHandle(inputRef.current);
      if (inputHandle) AccessibilityInfo.setAccessibilityFocus(inputHandle);
    }, 0);
    return () => clearTimeout(timeout);
  }, [pageOpen]);

  useEffect(() => {
    if (openRequest <= 0) return;
    setInputHeight(COLLAPSED_INPUT_HEIGHT);
    setInputLineCount(1);
    setInputSelection({ start: valueRef.current.length, end: valueRef.current.length });
    onFocusChangeRef.current?.(true);
    setPageOpen(true);
  }, [openRequest]);

  useEffect(() => () => {
    closeSubscriptionRef.current?.remove();
    if (closeFallbackRef.current) clearTimeout(closeFallbackRef.current);
  }, []);

  useEffect(() => {
    if (value.length !== 0) return;
    const timeout = setTimeout(() => {
      setInputHeight(COLLAPSED_INPUT_HEIGHT);
      setInputLineCount(1);
    }, 0);
    return () => clearTimeout(timeout);
  }, [value]);

  function submit() {
    if (!disabled && editable && value.trim()) onSubmit();
  }

  const composer = (expanded: boolean) => {
    const multiline = expanded && inputHeight > COLLAPSED_INPUT_HEIGHT;
    const inputValue = expanded ? value : (value.split(/\r?\n/)[0] ?? "");
    return <View style={[styles.composer, multiline && styles.composerOpen]}>
    {onLeadingPress ? (
      <Button
        accessibilityLabel={leadingAccessibilityLabel ?? "Core actions"}
        contentMode="raw"
        disabled={leadingDisabled}
        onPress={onLeadingPress}
        size="sm"
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
          const lineCount = Math.max(1, nativeEvent.lines.length);
          const nextHeight = INPUT_VERTICAL_PADDING * 2 + INPUT_LINE_HEIGHT * Math.min(6, lineCount);
          setInputLineCount(lineCount);
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
          if (expanded && nextValue.length === 0) {
            setInputHeight(COLLAPSED_INPUT_HEIGHT);
            setInputLineCount(1);
          }
          onChangeText(nextValue);
        }}
        onFocus={() => {
          if (expanded) return;
          if (intentionalFocus.current) {
            intentionalFocus.current = false;
            openPage();
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
        scrollEnabled={expanded && inputLineCount > 6}
        selection={expanded ? inputSelection : undefined}
        showSoftInputOnFocus={expanded}
        style={[styles.input, !multiline && styles.inputSingleLine]}
        textAlignVertical={multiline ? "top" : "center"}
        value={inputValue}
      />
    </View>
    <Button
      accessibilityLabel="Send to Core"
      contentMode="raw"
      disabled={disabled || !value.trim()}
      loading={loading}
      onPress={submit}
      size="sm"
      style={multiline ? styles.sendBottom : undefined}
      variant="primary"
    >
      {sendIcon}
    </Button>
  </View>;
  };

  return (
    <>
      {!pageOpen ? <View pointerEvents="box-none" style={[styles.layer, {
        marginTop: spacing.sm,
        paddingBottom: Math.max(insets.bottom, spacing.sm),
        paddingLeft: Math.max(insets.left, spacing.md),
        paddingRight: Math.max(insets.right, spacing.md),
      }]}>
        {accessory}{composer(false)}
      </View> : null}
      {pageOpen ? <CorePage bottomInset={insets.bottom} closePage={closePage} composer={composer(true)} inputRef={inputRef} leftInset={insets.left} message={message} pageIdentity={pageIdentity} releaseSelection={releaseInputSelection} rightInset={insets.right} style={style} topInset={insets.top} /> : null}
    </>
  );
}

const styles = StyleSheet.create({
  layer: {
    gap: 6,
    zIndex: 20,
  },
  page: {
    bottom: 0,
    backgroundColor: colors.page,
    elevation: 30,
    left: 0,
    position: "absolute",
    right: 0,
    top: 0,
    zIndex: 100,
  },
  pageIdentityHeader: {
    minHeight: 64,
    paddingBottom: 8,
    justifyContent: "center",
    borderBottomColor: colors.hairline,
    borderBottomWidth: 1,
  },
  pageContent: {
    flex: 1,
    gap: spacing.md,
    paddingTop: spacing.md,
  },
  pageTitleRow: {
    minHeight: 48,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
  },
  pageTitle: {
    flex: 1,
    minWidth: 0,
    color: colors.text,
    fontFamily: "Geist_300Light",
    fontSize: 24,
  },
  pageTitleSpacer: { width: 28 },
  pageConversation: {
    flex: 1,
    justifyContent: "flex-end",
  },
  composer: {
    alignItems: "center",
    backgroundColor: colors.page,
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
