import { useMemo } from "react";
import { StyleSheet, View } from "react-native";
import Svg, {
  Circle,
  Defs,
  Ellipse,
  LinearGradient,
  Path,
  Polygon,
  Polyline,
  RadialGradient,
  Rect,
  Stop,
} from "react-native-svg";

import type { GalleryVariant } from "@/data/mock";
import { createRandom } from "@/lib/random";
import { palette } from "@/theme/tokens";

const VIEW = 100;

function Stars({ seed, count }: { seed: number; count: number }) {
  const stars = useMemo(() => {
    const random = createRandom(seed * 101 + 3);
    return Array.from({ length: count }, () => ({
      x: random() * VIEW,
      y: random() * VIEW,
      r: 0.4 + random() * 0.9,
      o: 0.25 + random() * 0.6,
    }));
  }, [seed, count]);
  return (
    <>
      {stars.map((star, i) => (
        <Circle key={i} cx={star.x} cy={star.y} r={star.r} fill="#FFFFFF" opacity={star.o} />
      ))}
    </>
  );
}

function Scene({ variant, seed }: { variant: GalleryVariant; seed: number }) {
  switch (variant) {
    case "spire":
      return (
        <>
          <Stars seed={seed} count={12} />
          <Circle cx={72} cy={24} r={7} fill={palette.silver300} opacity={0.7} />
          <Polygon points="38,100 50,18 62,100" fill="#161C24" />
          <Polyline points="50,18 50,100" stroke={palette.silver500} strokeWidth={0.7} opacity={0.7} fill="none" />
        </>
      );
    case "planet":
      return (
        <>
          <Stars seed={seed} count={10} />
          <Circle cx={50} cy={48} r={22} fill="url(#thumbMetal)" />
          <Ellipse
            cx={50}
            cy={50}
            rx={34}
            ry={9}
            stroke={palette.silver300}
            strokeWidth={1}
            opacity={0.55}
            fill="none"
          />
        </>
      );
    case "constellation": {
      const random = createRandom(seed * 7 + 1);
      const points = Array.from({ length: 6 }, () => ({
        x: 14 + random() * 72,
        y: 14 + random() * 72,
      }));
      const line = points.map((p) => `${p.x},${p.y}`).join(" ");
      return (
        <>
          <Stars seed={seed} count={14} />
          <Polyline points={line} stroke={palette.silver300} strokeWidth={0.6} opacity={0.6} fill="none" />
          {points.map((p, i) => (
            <Circle key={i} cx={p.x} cy={p.y} r={1.8} fill={palette.silver50} />
          ))}
        </>
      );
    }
    case "arch":
      return (
        <>
          <Stars seed={seed} count={12} />
          <Path
            d="M 18 100 L 18 52 Q 50 8 82 52 L 82 100 L 66 100 L 66 58 Q 50 34 34 58 L 34 100 Z"
            fill="#161C24"
            stroke={palette.silver700}
            strokeWidth={0.8}
          />
        </>
      );
    case "crescent":
      return (
        <>
          <Stars seed={seed} count={12} />
          <Circle cx={54} cy={44} r={20} fill="url(#thumbMetal)" />
          <Circle cx={62} cy={38} r={19} fill="url(#thumbBg)" />
        </>
      );
    case "nebula":
      return (
        <>
          <Ellipse cx={38} cy={44} rx={30} ry={18} fill="url(#thumbGlow)" opacity={0.5} />
          <Ellipse cx={64} cy={60} rx={26} ry={14} fill="url(#thumbGlow)" opacity={0.35} />
          <Stars seed={seed} count={18} />
        </>
      );
  }
}

export type GalleryThumbProps = {
  variant: GalleryVariant;
  seed: number;
  size: number;
};

/** Procedural monochrome cosmic thumbnail — local mock imagery, no assets. */
export function GalleryThumb({ variant, seed, size }: GalleryThumbProps) {
  return (
    <View style={[styles.frame, { width: size, height: size }]}>
      <Svg width={size} height={size} viewBox={`0 0 ${VIEW} ${VIEW}`}>
        <Defs>
          <LinearGradient id="thumbBg" x1="0%" y1="0%" x2="0%" y2="100%">
            <Stop offset="0%" stopColor="#10151C" />
            <Stop offset="100%" stopColor="#05070A" />
          </LinearGradient>
          <LinearGradient id="thumbMetal" x1="0%" y1="0%" x2="100%" y2="100%">
            <Stop offset="0%" stopColor={palette.silver100} />
            <Stop offset="55%" stopColor={palette.silver500} />
            <Stop offset="100%" stopColor={palette.silver700} />
          </LinearGradient>
          <RadialGradient id="thumbGlow" cx="50%" cy="50%" r="50%">
            <Stop offset="0%" stopColor={palette.silver300} stopOpacity={0.5} />
            <Stop offset="100%" stopColor={palette.silver300} stopOpacity={0} />
          </RadialGradient>
        </Defs>
        <Rect x={0} y={0} width={VIEW} height={VIEW} fill="url(#thumbBg)" />
        <Scene variant={variant} seed={seed} />
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({
  frame: {
    borderRadius: 12,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: palette.hairline,
  },
});
