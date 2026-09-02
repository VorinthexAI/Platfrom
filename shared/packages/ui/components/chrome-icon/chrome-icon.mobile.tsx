import { Image, type ImageSource } from "expo-image";
import { StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import Svg, { Circle, Defs, RadialGradient, Stop } from "react-native-svg";

export type ChromeIconProps = {
  source: ImageSource;
  size: number;
  glow?: number;
  style?: StyleProp<ViewStyle>;
};

export function ChromeIcon({ source, size, glow = 0.55, style }: ChromeIconProps) {
  const haloSize = size * 1.9;
  return <View style={[{ width: size, height: size }, styles.root, style]}>
    <Svg height={haloSize} pointerEvents="none" style={[styles.halo, { top: (size - haloSize) / 2, left: (size - haloSize) / 2 }]} viewBox="0 0 100 100" width={haloSize}>
      <Defs><RadialGradient cx="50%" cy="50%" id="chromeHalo" r="50%"><Stop offset="0%" stopColor="#DDE2E5" stopOpacity={0.28 * glow} /><Stop offset="55%" stopColor="#DDE2E5" stopOpacity={0.1 * glow} /><Stop offset="100%" stopColor="#DDE2E5" stopOpacity={0} /></RadialGradient></Defs>
      <Circle cx={50} cy={50} fill="url(#chromeHalo)" r={50} />
    </Svg>
    <Image contentFit="contain" source={source} style={{ width: size, height: size }} transition={0} />
  </View>;
}

const styles = StyleSheet.create({
  root: { alignItems: "center", justifyContent: "center" },
  halo: { position: "absolute" },
});
