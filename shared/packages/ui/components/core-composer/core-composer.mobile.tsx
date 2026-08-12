import {
  useEffect,
  useId,
  useState,
  type ReactNode,
} from "react";
import {
  AccessibilityInfo,
  Animated,
  Keyboard,
  StyleSheet,
  View,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Svg, { Defs, LinearGradient, Stop, Text as SvgText } from "react-native-svg";

import { Button } from "../button/button.mobile";
import { TextInput } from "../text-input/text-input.mobile";
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

  const prompt = prompts[index % Math.max(prompts.length, 1)] ?? "Ask Core anything...";
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
          y="24"
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
  prompts,
  sendIcon,
  style,
  value,
}: CoreComposerProps) {
  const insets = useSafeAreaInsets();
  const [focused, setFocused] = useState(false);

  function setFocus(nextFocused: boolean) {
    setFocused(nextFocused);
    onFocusChange?.(nextFocused);
  }

  function submit() {
    if (!disabled && editable && value.trim()) onSubmit();
  }

  return (
    <View pointerEvents="box-none" style={styles.layer}>
      {focused ? (
        <Button
          accessibilityLabel="Dismiss Core"
          contentMode="raw"
          onPress={Keyboard.dismiss}
          pressFeedback="none"
          size="xl"
          style={styles.backdrop}
          variant="ghost"
        >
          <View />
        </Button>
      ) : null}
      <View
        pointerEvents="box-none"
        style={[
          styles.wrap,
          { bottom: focused ? 6 : insets.bottom + 12 },
          style,
        ]}
      >
        {message}
        <View style={[styles.composer, focused && styles.composerFocused]}>
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
            {!value ? <RotatingPrompt prompts={prompts} /> : null}
            <TextInput
              accessibilityHint={accessibilityHint}
              accessibilityLabel={accessibilityLabel}
              editable={editable}
              maxLength={maxLength}
              onBlur={() => setFocus(false)}
              onChangeText={onChangeText}
              onFocus={() => setFocus(true)}
              onSubmitEditing={submit}
              placeholder=""
              returnKeyType="send"
              style={styles.input}
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
    backgroundColor: "rgba(3, 5, 7, 0.68)",
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
  composerFocused: {
    borderColor: "#55616C",
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
