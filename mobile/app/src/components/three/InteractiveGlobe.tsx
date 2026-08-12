import { useMemo, useState } from "react";
import type { StyleProp, ViewStyle } from "react-native";
import { PanResponder, StyleSheet, View } from "react-native";
import Svg, { Circle, ClipPath, Defs, G, Path } from "react-native-svg";

export type InteractiveGlobeProps = {
  style?: StyleProp<ViewStyle>;
};

type Coordinate = readonly [longitude: number, latitude: number];
type Rotation = { yaw: number; pitch: number };

const SIZE = 320;
const CENTER = SIZE / 2;
const RADIUS = 132;
const LINE = "rgba(184, 199, 208, 0.3)";
const LAND_LINE = "rgba(213, 224, 230, 0.72)";

const CONTINENTS: readonly Coordinate[][] = [
  [[-168, 68], [-145, 72], [-124, 59], [-108, 52], [-97, 29], [-82, 25], [-74, 43], [-60, 47], [-53, 60], [-73, 72], [-105, 76], [-138, 72], [-168, 68]],
  [[-81, 12], [-70, 8], [-55, -2], [-46, -22], [-55, -39], [-68, -55], [-76, -28], [-81, 12]],
  [[-18, 36], [5, 37], [31, 31], [43, 11], [34, -10], [23, -35], [9, -31], [-3, -5], [-17, 15], [-18, 36]],
  [[-10, 36], [7, 52], [35, 61], [67, 71], [102, 68], [137, 55], [161, 61], [177, 48], [151, 35], [126, 22], [103, 6], [79, 9], [55, 24], [35, 31], [14, 42], [-10, 36]],
  [[112, -12], [132, -10], [153, -24], [146, -40], [122, -43], [112, -12]],
  [[-52, 60], [-42, 76], [-22, 82], [-18, 68], [-35, 59], [-52, 60]],
];

function latitudeLine(latitude: number): Coordinate[] {
  return Array.from({ length: 49 }, (_, index) => [-180 + index * 7.5, latitude] as const);
}

function longitudeLine(longitude: number): Coordinate[] {
  return Array.from({ length: 25 }, (_, index) => [longitude, -90 + index * 7.5] as const);
}

const GRID = [
  latitudeLine(-45), latitudeLine(0), latitudeLine(45),
  longitudeLine(-120), longitudeLine(-60), longitudeLine(0), longitudeLine(60), longitudeLine(120),
];

function project([longitude, latitude]: Coordinate, rotation: Rotation) {
  "worklet";
  const longitudeRadians = longitude * Math.PI / 180;
  const latitudeRadians = latitude * Math.PI / 180;
  const sourceX = Math.cos(latitudeRadians) * Math.sin(longitudeRadians);
  const sourceY = Math.sin(latitudeRadians);
  const sourceZ = Math.cos(latitudeRadians) * Math.cos(longitudeRadians);
  const yawX = sourceX * Math.cos(rotation.yaw) + sourceZ * Math.sin(rotation.yaw);
  const yawZ = -sourceX * Math.sin(rotation.yaw) + sourceZ * Math.cos(rotation.yaw);
  const rotatedY = sourceY * Math.cos(rotation.pitch) - yawZ * Math.sin(rotation.pitch);
  const rotatedZ = sourceY * Math.sin(rotation.pitch) + yawZ * Math.cos(rotation.pitch);
  return { x: CENTER + yawX * RADIUS, y: CENTER - rotatedY * RADIUS, visible: rotatedZ >= 0 };
}

function pathFor(lines: readonly Coordinate[][], rotation: Rotation) {
  return lines.map((line) => {
    let path = "";
    let drawing = false;
    for (const coordinate of line) {
      const point = project(coordinate, rotation);
      if (!point.visible) {
        drawing = false;
        continue;
      }
      path += `${drawing ? "L" : "M"}${point.x.toFixed(1)} ${point.y.toFixed(1)}`;
      drawing = true;
    }
    return path;
  }).join("");
}

export function InteractiveGlobe({ style }: InteractiveGlobeProps) {
  const [rotation, setRotation] = useState<Rotation>({ yaw: -0.35, pitch: -0.12 });
  const [responder] = useState(() => {
    let previousX = 0;
    let previousY = 0;
    return PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: () => { previousX = 0; previousY = 0; },
      onPanResponderMove: (_, gesture) => {
        const deltaX = gesture.dx - previousX;
        const deltaY = gesture.dy - previousY;
        previousX = gesture.dx;
        previousY = gesture.dy;
        setRotation((current) => ({
          yaw: current.yaw + deltaX / RADIUS,
          pitch: Math.max(-Math.PI / 2, Math.min(Math.PI / 2, current.pitch - deltaY / RADIUS)),
        }));
      },
    });
  });
  const gridPath = useMemo(() => pathFor(GRID, rotation), [rotation]);
  const continentPath = useMemo(() => pathFor(CONTINENTS, rotation), [rotation]);

  return (
    <View accessibilityLabel="Rotatable globe" accessibilityRole="adjustable" style={[styles.root, style]} {...responder.panHandlers}>
      <View pointerEvents="none" style={styles.glow} />
      <Svg height={SIZE} pointerEvents="none" width={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`}>
        <Defs><ClipPath id="globe-clip"><Circle cx={CENTER} cy={CENTER} r={RADIUS} /></ClipPath></Defs>
        <Circle cx={CENTER} cy={CENTER} fill="#081017" r={RADIUS} stroke="rgba(219, 229, 234, 0.62)" strokeWidth="1.5" />
        <G clipPath="url(#globe-clip)">
          <Path d={gridPath} fill="none" stroke={LINE} strokeWidth="1" />
          <Path d={continentPath} fill="none" stroke={LAND_LINE} strokeLinejoin="round" strokeWidth="1.5" />
        </G>
        <Circle cx={CENTER} cy={CENTER} fill="none" r={RADIUS + 5} stroke="rgba(125, 162, 184, 0.12)" strokeWidth="10" />
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, alignItems: "center", justifyContent: "center" },
  glow: { position: "absolute", width: RADIUS * 2, height: RADIUS * 2, borderRadius: RADIUS, backgroundColor: "rgba(73, 117, 143, 0.09)", boxShadow: "0 0 70px rgba(80, 132, 163, 0.22)" },
});
