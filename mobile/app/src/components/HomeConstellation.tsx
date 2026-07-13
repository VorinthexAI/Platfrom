import { StyleSheet, View, useWindowDimensions } from "react-native";
import Animated, { FadeInDown } from "react-native-reanimated";
import Svg, { Path } from "react-native-svg";

import { ChromeIcon } from "@/components/ChromeIcon";
import { PressableScale } from "@/components/PressableScale";
import { NeuralField3D } from "@/components/three/NeuralField3D";
import { capabilityIconSource } from "@/data/capability-icons";
import { CAPABILITIES, type CapabilitySlug } from "@/data/registry";
import { durations } from "@/theme/motion";
import { palette } from "@/theme/tokens";

const NODE_SIZE = 62;

/** Capability node layout, matched to the approved home mockup. */
const NODE_POSITIONS: Record<CapabilitySlug, { x: number; y: number }> = {
  archive: { x: 0.5, y: 0.07 },
  gallery: { x: 0.14, y: 0.33 },
  signal: { x: 0.86, y: 0.33 },
  compass: { x: 0.21, y: 0.75 },
  ascend: { x: 0.79, y: 0.75 },
};

// Matches the 3D field's core glow, which sits at the canvas center.
const CENTER = { x: 0.5, y: 0.5 };

function filamentPath(
  width: number,
  height: number,
  to: { x: number; y: number },
  bend: number,
): string {
  const cx = CENTER.x * width;
  const cy = CENTER.y * height;
  const tx = to.x * width;
  const ty = to.y * height;
  const mx = (cx + tx) / 2;
  const my = (cy + ty) / 2;
  const length = Math.hypot(tx - cx, ty - cy) || 1;
  // Perpendicular offset gives each filament a gentle organic curve.
  const nx = (-(ty - cy) / length) * bend;
  const ny = ((tx - cx) / length) * bend;
  return `M ${cx} ${cy} Q ${mx + nx} ${my + ny} ${tx} ${ty}`;
}

export type HomeConstellationProps = {
  onOpen: (slug: CapabilitySlug) => void;
};

/**
 * The AI brain home: a neural constellation with the five capability
 * nodes orbiting a glowing core.
 */
export function HomeConstellation({ onOpen }: HomeConstellationProps) {
  const { width: screenWidth } = useWindowDimensions();
  const width = Math.min(screenWidth - 16, 390);
  const height = 450;

  return (
    <View style={[styles.root, { width, height }]}>
      <NeuralField3D
        seed={31}
        count={110}
        radius={5}
        speed={0.05}
        coreGlow
        style={[StyleSheet.absoluteFill, { width, height }]}
      />
      <Svg width={width} height={height} style={StyleSheet.absoluteFill} pointerEvents="none">
        {CAPABILITIES.map((capability, i) => (
          <Path
            key={capability.slug}
            d={filamentPath(width, height, NODE_POSITIONS[capability.slug], i % 2 === 0 ? 16 : -16)}
            stroke={palette.silver300}
            strokeWidth={0.6}
            opacity={0.4}
            fill="none"
          />
        ))}
      </Svg>

      {CAPABILITIES.map((capability, i) => {
        const position = NODE_POSITIONS[capability.slug];
        return (
          <Animated.View
            key={capability.slug}
            entering={FadeInDown.delay(160 + i * 90).duration(durations.base)}
            style={[
              styles.node,
              {
                left: position.x * width - NODE_SIZE / 2,
                top: position.y * height - NODE_SIZE / 2,
              },
            ]}
          >
            <PressableScale
              accessibilityRole="button"
              accessibilityLabel={`Open ${capability.name}`}
              onPress={() => onOpen(capability.slug)}
            >
              <ChromeIcon
                source={capabilityIconSource[capability.slug]}
                size={NODE_SIZE}
                glow={0.5}
              />
            </PressableScale>
          </Animated.View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    alignSelf: "center",
  },
  node: {
    position: "absolute",
  },
});
