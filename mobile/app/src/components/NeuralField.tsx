import { useEffect, useMemo } from "react";
import type { StyleProp, ViewStyle } from "react-native";
import Animated, {
  useAnimatedProps,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
} from "react-native-reanimated";
import Svg, { Circle, Line } from "react-native-svg";

import { createRandom } from "@/lib/random";
import { easings } from "@/theme/motion";
import { palette } from "@/theme/tokens";

const AnimatedCircle = Animated.createAnimatedComponent(Circle);

type FieldNode = { x: number; y: number; r: number; opacity: number };
type FieldEdge = { x1: number; y1: number; x2: number; y2: number; opacity: number };

function buildField(width: number, height: number, seed: number, nodeCount: number) {
  const random = createRandom(seed);
  const nodes: FieldNode[] = Array.from({ length: nodeCount }, () => ({
    x: random() * width,
    y: random() * height,
    r: 0.8 + random() * 1.5,
    opacity: 0.2 + random() * 0.5,
  }));

  const edges: FieldEdge[] = [];
  const maxDistance = Math.min(width, height) * 0.3;
  nodes.forEach((node, i) => {
    const neighbors = nodes
      .map((other, j) => ({
        j,
        distance: Math.hypot(other.x - node.x, other.y - node.y),
      }))
      .filter((entry) => entry.j > i && entry.distance < maxDistance)
      .sort((a, b) => a.distance - b.distance)
      .slice(0, 2);
    for (const { j } of neighbors) {
      const other = nodes[j];
      if (!other) continue;
      edges.push({
        x1: node.x,
        y1: node.y,
        x2: other.x,
        y2: other.y,
        opacity: 0.06 + random() * 0.14,
      });
    }
  });

  return { nodes, edges };
}

function Pulse({ cx, cy, r, delay }: { cx: number; cy: number; r: number; delay: number }) {
  const opacity = useSharedValue(0.12);

  useEffect(() => {
    opacity.value = withDelay(
      delay,
      withRepeat(
        withSequence(
          withTiming(0.85, { duration: 1300, easing: easings.inOut }),
          withTiming(0.12, { duration: 1700, easing: easings.inOut }),
        ),
        -1,
        false,
      ),
    );
  }, [delay, opacity]);

  const animatedProps = useAnimatedProps(() => ({ opacity: opacity.value }));

  return (
    <AnimatedCircle
      cx={cx}
      cy={cy}
      r={r}
      fill={palette.silver100}
      animatedProps={animatedProps}
    />
  );
}

export type NeuralFieldProps = {
  width: number;
  height: number;
  seed?: number;
  nodeCount?: number;
  pulseCount?: number;
  style?: StyleProp<ViewStyle>;
};

/**
 * Reusable monochrome neural background: seeded constellation of nodes,
 * filaments, and slow light pulses. Silver on obsidian only.
 */
export function NeuralField({
  width,
  height,
  seed = 7,
  nodeCount = 42,
  pulseCount = 6,
  style,
}: NeuralFieldProps) {
  const { nodes, edges } = useMemo(
    () => buildField(width, height, seed, nodeCount),
    [width, height, seed, nodeCount],
  );

  const pulses = useMemo(() => {
    if (nodes.length === 0) return [];
    const step = Math.max(1, Math.floor(nodes.length / pulseCount));
    return Array.from({ length: pulseCount }, (_, i) => nodes[(i * step) % nodes.length]).filter(
      (node): node is FieldNode => node !== undefined,
    );
  }, [nodes, pulseCount]);

  return (
    <Svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      style={style}
      pointerEvents="none"
    >
      {edges.map((edge, i) => (
        <Line
          key={`e${i}`}
          x1={edge.x1}
          y1={edge.y1}
          x2={edge.x2}
          y2={edge.y2}
          stroke={palette.silver300}
          strokeWidth={0.5}
          opacity={edge.opacity}
        />
      ))}
      {nodes.map((node, i) => (
        <Circle
          key={`n${i}`}
          cx={node.x}
          cy={node.y}
          r={node.r}
          fill={palette.silver100}
          opacity={node.opacity}
        />
      ))}
      {pulses.map((node, i) => (
        <Pulse key={`p${i}`} cx={node.x} cy={node.y} r={node.r + 1.4} delay={i * 420} />
      ))}
    </Svg>
  );
}
