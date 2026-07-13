import type { ReactNode } from "react";
import { useEffect, useMemo } from "react";
import Animated, {
  interpolate,
  useAnimatedProps,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
  type SharedValue,
} from "react-native-reanimated";
import Svg, { Circle, G, Line, Path } from "react-native-svg";

import { createRandom } from "@/lib/random";
import { easings } from "@/theme/motion";
import { palette } from "@/theme/tokens";

const AnimatedG = Animated.createAnimatedComponent(G);
const AnimatedCircle = Animated.createAnimatedComponent(Circle);

const VIEW_W = 320;
const VIEW_H = 340;
const GROUPS = 6;

type BrainNode = { x: number; y: number; r: number; opacity: number; group: number };
type BrainEdge = { x1: number; y1: number; x2: number; y2: number; opacity: number; group: number };

/** Side-profile brain silhouette: cerebrum + cerebellum + tapering stem. */
function insideBrain(x: number, y: number): boolean {
  const cerebrum = ((x - 158) / 102) ** 2 + ((y - 128) / 84) ** 2 <= 1;
  const cerebellum = Math.hypot(x - 212, y - 200) <= 34;
  const stem =
    y >= 212 && y <= 258 && Math.abs(x - 188) <= Math.max(4, 15 - (y - 212) * 0.22);
  return cerebrum || cerebellum || stem;
}

function buildBrain(seed: number) {
  const random = createRandom(seed);
  const nodes: BrainNode[] = [];
  let guard = 0;
  while (nodes.length < 92 && guard < 4000) {
    guard += 1;
    const x = 40 + random() * 240;
    const y = 24 + random() * 250;
    if (!insideBrain(x, y)) continue;
    nodes.push({
      x,
      y,
      r: 1 + random() * 1.8,
      opacity: 0.35 + random() * 0.55,
      group: 0,
    });
  }

  // Reveal center-out: group index by distance from the brain's core.
  const sorted = [...nodes].sort(
    (a, b) => Math.hypot(a.x - 170, a.y - 140) - Math.hypot(b.x - 170, b.y - 140),
  );
  sorted.forEach((node, i) => {
    node.group = Math.min(GROUPS - 1, Math.floor((i / sorted.length) * GROUPS));
  });

  const edges: BrainEdge[] = [];
  nodes.forEach((node, i) => {
    const neighbors = nodes
      .map((other, j) => ({ j, distance: Math.hypot(other.x - node.x, other.y - node.y) }))
      .filter((entry) => entry.j > i && entry.distance < 52)
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
        opacity: 0.1 + random() * 0.2,
        group: Math.max(node.group, other.group),
      });
    }
  });

  // Filament streams descending from the stem toward the progress line.
  const streams = [176, 188, 199].map((x0, i) => {
    const sway = (random() - 0.5) * 22;
    return `M ${x0} ${246 + i * 4} C ${x0 + sway} ${280}, ${x0 - sway} ${306}, ${x0 + sway * 0.4} ${VIEW_H - 4}`;
  });

  return { nodes, edges, streams };
}

function RevealGroup({
  progress,
  index,
  children,
}: {
  progress: SharedValue<number>;
  index: number;
  children: ReactNode;
}) {
  const start = index * 0.13;
  const animatedProps = useAnimatedProps(() => ({
    opacity: interpolate(progress.value, [start, start + 0.2], [0.05, 1], "clamp"),
  }));
  return <AnimatedG animatedProps={animatedProps}>{children}</AnimatedG>;
}

function BrainPulse({ cx, cy, r, delay }: { cx: number; cy: number; r: number; delay: number }) {
  const opacity = useSharedValue(0.15);
  useEffect(() => {
    opacity.value = withDelay(
      delay,
      withRepeat(
        withSequence(
          withTiming(0.95, { duration: 1100, easing: easings.inOut }),
          withTiming(0.15, { duration: 1500, easing: easings.inOut }),
        ),
        -1,
        false,
      ),
    );
  }, [delay, opacity]);
  const animatedProps = useAnimatedProps(() => ({ opacity: opacity.value }));
  return (
    <AnimatedCircle cx={cx} cy={cy} r={r} fill={palette.chromeWhite} animatedProps={animatedProps} />
  );
}

export type NeuralBrainProps = {
  /** Rendered width; height follows the intrinsic aspect ratio. */
  width: number;
  /** 0–1 build progress; clusters of the brain light up center-out. */
  progress: SharedValue<number>;
  seed?: number;
};

/** Monochrome neural brain made of nodes, filaments, and light pulses. */
export function NeuralBrain({ width, progress, seed = 19 }: NeuralBrainProps) {
  const { nodes, edges, streams } = useMemo(() => buildBrain(seed), [seed]);

  const groups = useMemo(
    () =>
      Array.from({ length: GROUPS }, (_, g) => ({
        nodes: nodes.filter((node) => node.group === g),
        edges: edges.filter((edge) => edge.group === g),
      })),
    [nodes, edges],
  );

  const pulses = useMemo(
    () => nodes.filter((_, i) => i % 12 === 0).slice(0, 8),
    [nodes],
  );

  return (
    <Svg
      width={width}
      height={(width * VIEW_H) / VIEW_W}
      viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
      pointerEvents="none"
    >
      {groups.map((group, g) => (
        <RevealGroup key={g} progress={progress} index={g}>
          {group.edges.map((edge, i) => (
            <Line
              key={`e${i}`}
              x1={edge.x1}
              y1={edge.y1}
              x2={edge.x2}
              y2={edge.y2}
              stroke={palette.silver300}
              strokeWidth={0.55}
              opacity={edge.opacity}
            />
          ))}
          {group.nodes.map((node, i) => (
            <Circle
              key={`n${i}`}
              cx={node.x}
              cy={node.y}
              r={node.r}
              fill={palette.silver50}
              opacity={node.opacity}
            />
          ))}
        </RevealGroup>
      ))}
      <RevealGroup progress={progress} index={GROUPS - 1}>
        {streams.map((d, i) => (
          <Path
            key={`s${i}`}
            d={d}
            stroke={palette.silver500}
            strokeWidth={0.7}
            opacity={0.35}
            fill="none"
          />
        ))}
      </RevealGroup>
      {pulses.map((node, i) => (
        <BrainPulse key={`p${i}`} cx={node.x} cy={node.y} r={node.r + 1.2} delay={i * 360} />
      ))}
    </Svg>
  );
}
