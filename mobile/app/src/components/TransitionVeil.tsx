import { useEffect } from "react";
import { StyleSheet } from "react-native";
import Animated, {
  Easing,
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
 *
 * The phase hand-off is driven by a JS timer, NOT a withTiming completion
 * callback — worklet→JS completion trampolines racing unmounts have
 * segfaulted the worklets runtime on Android.
 */
export function TransitionVeil() {
  const phase = useGalaxyStore((state) => state.phase);
  const arriveInside = useGalaxyStore((state) => state.arriveInside);
  const finishExit = useGalaxyStore((state) => state.finishExit);
  const opacity = useSharedValue(0);

  const covering = phase === "enter" || phase === "exit";

  useEffect(() => {
    if (!covering) {
      opacity.value = withTiming(0, {
        duration: OPEN_MS,
        easing: Easing.out(Easing.cubic),
      });
      return;
    }
    const onDark = phase === "enter" ? arriveInside : finishExit;
    opacity.value = withTiming(1, {
      duration: CLOSE_MS,
      easing: Easing.in(Easing.cubic),
    });
    const timer = setTimeout(onDark, CLOSE_MS + 60);
    return () => clearTimeout(timer);
  }, [arriveInside, covering, finishExit, opacity, phase]);

  const style = useAnimatedStyle(() => ({ opacity: opacity.value }));

  return <Animated.View pointerEvents="none" style={[styles.veil, style]} />;
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
