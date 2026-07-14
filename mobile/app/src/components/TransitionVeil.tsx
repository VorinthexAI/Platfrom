import { useEffect, useRef } from "react";
import { StyleSheet } from "react-native";
import Animated, {
  Easing,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";

import { useGalaxyStore } from "@/state/galaxy";

const CLOSE_MS = 280;
const OPEN_MS = 700;

/**
 * The web TransitionVeil as a Reanimated overlay: while the camera
 * punches through a planet crust (phase "enter") or leaves an interior
 * (phase "exit"), obsidian closes over the scene in 280ms, the teleport
 * happens in the dark, then the veil lifts in 700ms.
 */
export function TransitionVeil() {
  const phase = useGalaxyStore((state) => state.phase);
  const arriveInside = useGalaxyStore((state) => state.arriveInside);
  const finishExit = useGalaxyStore((state) => state.finishExit);
  const opacity = useSharedValue(0);
  const backstopRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const covering = phase === "enter" || phase === "exit";

  useEffect(() => {
    if (!covering) return;
    const onDark = phase === "enter" ? arriveInside : finishExit;
    opacity.value = withTiming(
      1,
      { duration: CLOSE_MS, easing: Easing.in(Easing.cubic) },
      (finished) => {
        if (finished) runOnJS(onDark)();
      },
    );
    // Backstop (web parity): never strand the visitor mid-veil.
    backstopRef.current = setTimeout(onDark, CLOSE_MS + 420);
    return () => {
      if (backstopRef.current) clearTimeout(backstopRef.current);
    };
  }, [arriveInside, covering, finishExit, opacity, phase]);

  useEffect(() => {
    if (covering) return;
    opacity.value = withTiming(0, {
      duration: OPEN_MS,
      easing: Easing.out(Easing.cubic),
    });
  }, [covering, opacity]);

  const style = useAnimatedStyle(() => ({ opacity: opacity.value }));

  return (
    <Animated.View
      pointerEvents="none"
      style={[styles.veil, style]}
    />
  );
}

const styles = StyleSheet.create({
  veil: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    backgroundColor: "#020304",
    zIndex: 20,
  },
});
