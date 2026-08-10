import { Fragment, useMemo } from "react";
import Svg, { Circle, Defs, LinearGradient, Path, Stop } from "react-native-svg";

import { createRandom } from "@/lib/random";

type Point = { x: number; y: number };
type Branch = { start: Point; controlA: Point; controlB: Point; end: Point; warm: boolean };

function pointOnBranch(branch: Branch, progress: number) {
  const inverse = 1 - progress;
  return {
    x: inverse ** 3 * branch.start.x + 3 * inverse ** 2 * progress * branch.controlA.x + 3 * inverse * progress ** 2 * branch.controlB.x + progress ** 3 * branch.end.x,
    y: inverse ** 3 * branch.start.y + 3 * inverse ** 2 * progress * branch.controlA.y + 3 * inverse * progress ** 2 * branch.controlB.y + progress ** 3 * branch.end.y,
  };
}

export function NeuralBackdrop({ height, width }: { height: number; width: number }) {
  const branches = useMemo(() => {
    const random = createRandom(Math.round(width * 37 + height * 71));
    return Array.from({ length: width < 640 ? 54 : 92 }, (_, index): Branch => {
      const edge = index % 4;
      const horizontal = edge < 2;
      const start = horizontal
        ? { x: edge === 0 ? -24 : width + 24, y: random() * height }
        : { x: random() * width, y: edge === 2 ? -24 : height + 24 };
      const end = horizontal
        ? { x: width * (0.28 + random() * 0.44), y: height * (0.12 + random() * 0.76) }
        : { x: width * (0.08 + random() * 0.84), y: height * (0.28 + random() * 0.44) };
      const controlA = horizontal
        ? { x: start.x + (end.x - start.x) * (0.24 + random() * 0.16), y: start.y + (random() - 0.5) * height * 0.3 }
        : { x: start.x + (random() - 0.5) * width * 0.3, y: start.y + (end.y - start.y) * (0.24 + random() * 0.16) };
      const controlB = {
        x: start.x + (end.x - start.x) * (0.68 + random() * 0.15),
        y: start.y + (end.y - start.y) * (0.68 + random() * 0.15),
      };
      return { start, controlA, controlB, end, warm: index % 7 === 0 };
    });
  }, [height, width]);

  return (
    <Svg height={height} pointerEvents="none" viewBox={`0 0 ${width} ${height}`} width={width}>
      <Defs>
        {branches.map((branch, index) => {
          const color = branch.warm ? "rgb(209,220,225)" : "rgb(190,204,212)";
          return (
            <LinearGradient gradientUnits="userSpaceOnUse" id={`auth-branch-${index}`} key={index} x1={branch.start.x} x2={branch.end.x} y1={branch.start.y} y2={branch.end.y}>
              <Stop offset="0" stopColor={color} stopOpacity={0} />
              <Stop offset="0.08" stopColor={color} stopOpacity={0.15} />
              <Stop offset="0.65" stopColor={color} stopOpacity={0.09} />
              <Stop offset="1" stopColor={color} stopOpacity={0} />
            </LinearGradient>
          );
        })}
      </Defs>
      {branches.map((branch, index) => {
        const pulse = index % 5 === 0 ? pointOnBranch(branch, 0.52) : undefined;
        return (
          <Fragment key={index}>
            <Path
              d={`M ${branch.start.x} ${branch.start.y} C ${branch.controlA.x} ${branch.controlA.y}, ${branch.controlB.x} ${branch.controlB.y}, ${branch.end.x} ${branch.end.y}`}
              fill="none"
              stroke={`url(#auth-branch-${index})`}
              strokeWidth={0.65}
            />
            {pulse ? <Circle cx={pulse.x} cy={pulse.y} fill={branch.warm ? "rgba(226,235,239,0.34)" : "rgba(221,231,235,0.3)"} r={1.15} /> : null}
          </Fragment>
        );
      })}
    </Svg>
  );
}
