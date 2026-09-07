import { useEffect, useRef, useState } from "react";
import { AccessibilityInfo, Animated, Easing } from "react-native";

export const DELAYED_ACTION_MS = 3_000;

export function useDelayedAction(active: boolean, resetKey = "default") {
  const [visibleKey, setVisibleKey] = useState("__hidden__");
  const [opacity] = useState(() => new Animated.Value(0));
  const reducedMotion = useRef(true);

  useEffect(() => {
    let mounted = true;
    void AccessibilityInfo.isReduceMotionEnabled().then((enabled) => {
      if (mounted) reducedMotion.current = enabled;
    });
    const subscription = AccessibilityInfo.addEventListener("reduceMotionChanged", (enabled) => { reducedMotion.current = enabled; });
    return () => { mounted = false; subscription.remove(); };
  }, []);

  useEffect(() => {
    opacity.setValue(0);
    if (!active) return;
    let mounted = true;
    const timer = setTimeout(() => {
      if (!mounted) return;
      setVisibleKey(resetKey);
      if (reducedMotion.current) opacity.setValue(1);
      else Animated.timing(opacity, { duration: 240, easing: Easing.out(Easing.cubic), toValue: 1, useNativeDriver: true }).start();
    }, DELAYED_ACTION_MS);
    return () => { mounted = false; clearTimeout(timer); opacity.stopAnimation(); };
  }, [active, opacity, resetKey]);

  return { opacity, visible: active && visibleKey === resetKey };
}
