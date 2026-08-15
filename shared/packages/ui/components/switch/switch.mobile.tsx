import { useEffect, useRef, useState } from "react";
import {
  Animated,
  Pressable,
  StyleSheet,
  type PressableProps,
  type StyleProp,
  type ViewStyle,
} from "react-native";

import { colors } from "../../tokens";

export type SwitchProps = Omit<PressableProps, "accessibilityRole" | "onPress" | "style"> & {
  checked?: boolean;
  defaultChecked?: boolean;
  onCheckedChange?: (checked: boolean) => void;
  style?: StyleProp<ViewStyle>;
};

export function Switch({ checked, defaultChecked = false, disabled = false, onCheckedChange, style, ...props }: SwitchProps) {
  const [internalChecked, setInternalChecked] = useState(defaultChecked);
  const active = checked ?? internalChecked;
  const isDisabled = Boolean(disabled);
  const progress = useRef(new Animated.Value(active ? 1 : 0)).current;

  useEffect(() => {
    Animated.timing(progress, {
      duration: 160,
      toValue: active ? 1 : 0,
      useNativeDriver: true,
    }).start();
  }, [active, progress]);

  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityState={{ checked: active, disabled: isDisabled }}
      disabled={isDisabled}
      onPress={() => {
        const next = !active;
        if (checked === undefined) setInternalChecked(next);
        onCheckedChange?.(next);
      }}
      style={({ pressed }) => [styles.root, active && styles.rootChecked, pressed && !isDisabled && styles.rootPressed, isDisabled && styles.disabled, style]}
      {...props}
    >
      <Animated.View style={[styles.thumb, active && styles.thumbChecked, { transform: [{ translateX: progress.interpolate({ inputRange: [0, 1], outputRange: [0, 20] }) }] }]} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: {
    width: 44,
    height: 24,
    padding: 1,
    justifyContent: "center",
    borderColor: colors.border,
    borderRadius: 999,
    borderWidth: 1,
    backgroundColor: colors.secondary,
  },
  rootChecked: { borderColor: colors.accent, backgroundColor: colors.accent },
  rootPressed: { opacity: 0.82 },
  disabled: { opacity: 0.5 },
  thumb: { width: 20, height: 20, borderRadius: 999, backgroundColor: colors.muted },
  thumbChecked: { backgroundColor: colors.page },
});
