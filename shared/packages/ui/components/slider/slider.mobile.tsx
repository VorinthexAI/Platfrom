import { useState } from "react";
import {
  StyleSheet,
  View,
  type GestureResponderEvent,
  type ViewProps,
} from "react-native";

import { colors } from "../../tokens";

export type SliderProps = Omit<ViewProps, "onValueChange"> & {
  disabled?: boolean;
  max?: number;
  min?: number;
  onSlidingComplete?: (value: number) => void;
  onValueChange?: (value: number) => void;
  value: number;
};

export function Slider({
  accessibilityLabel,
  disabled = false,
  max = 1,
  min = 0,
  onSlidingComplete,
  onValueChange,
  style,
  value,
  ...props
}: SliderProps) {
  const [width, setWidth] = useState(0);
  const [preview, setPreview] = useState<number>();
  const clamp = (candidate: number) => Math.min(max, Math.max(min, candidate));
  const position = clamp(preview ?? value);
  const percent = max > min ? (position - min) / (max - min) : 0;
  const eventValue = (event: GestureResponderEvent) => clamp(
    min + (Math.max(0, Math.min(width, event.nativeEvent.locationX)) / Math.max(width, 1)) * (max - min),
  );
  const update = (event: GestureResponderEvent) => {
    const next = eventValue(event);
    setPreview(next);
    onValueChange?.(next);
  };

  return (
    <View
      accessibilityActions={[{ name: "increment" }, { name: "decrement" }]}
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="adjustable"
      accessibilityState={{ disabled }}
      accessibilityValue={{ min, max, now: position }}
      onAccessibilityAction={(event) => {
        if (disabled) return;
        const step = Math.max((max - min) / 20, 1);
        const next = clamp(position + (event.nativeEvent.actionName === "increment" ? step : -step));
        onValueChange?.(next);
        onSlidingComplete?.(next);
      }}
      onLayout={(event) => setWidth(event.nativeEvent.layout.width)}
      onMoveShouldSetResponder={() => !disabled}
      onResponderGrant={update}
      onResponderMove={update}
      onResponderRelease={(event) => {
        const next = eventValue(event);
        setPreview(undefined);
        onSlidingComplete?.(next);
      }}
      onStartShouldSetResponder={() => !disabled}
      style={[styles.root, disabled && styles.disabled, style]}
      {...props}
    >
      <View pointerEvents="none" style={styles.track}>
        <View style={[styles.range, { width: `${percent * 100}%` }]} />
      </View>
      <View pointerEvents="none" style={[styles.thumb, { left: `${percent * 100}%` }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { height: 28, justifyContent: "center", position: "relative" },
  disabled: { opacity: 0.45 },
  track: { height: 3, borderRadius: 2, overflow: "hidden", backgroundColor: colors.border },
  range: { height: "100%", backgroundColor: colors.accent },
  thumb: { width: 14, height: 14, marginLeft: -7, position: "absolute", borderRadius: 7, borderColor: colors.accent, borderWidth: 2, backgroundColor: colors.surface },
});
