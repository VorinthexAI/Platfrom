import { Image, type ImageSource } from "expo-image";
import { StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import Svg, { Circle, Defs, RadialGradient, Stop } from "react-native-svg";

/**
 * Reusable chrome icon treatment: the approved transparent PNG rendered
 * sharply over a soft neutral specular halo. No color, no redrawing.
 */
export type ChromeIconProps = {
  source: ImageSource;
  size: number;
  /** 0–1 strength of the metallic glow behind the icon. */
  glow?: number;
  style?: StyleProp<ViewStyle>;
};

export function ChromeIcon({ source, size, glow = 0.55, style }: ChromeIconProps) {
  const haloSize = size * 1.9;
  return (
    <View style={[{ width: size, height: size }, styles.root, style]}>
      <Svg
        width={haloSize}
        height={haloSize}
        viewBox="0 0 100 100"
        style={[styles.halo, { top: (size - haloSize) / 2, left: (size - haloSize) / 2 }]}
        pointerEvents="none"
      >
        <Defs>
          <RadialGradient id="chromeHalo" cx="50%" cy="50%" r="50%">
            <Stop offset="0%" stopColor="#DDE2E5" stopOpacity={0.28 * glow} />
            <Stop offset="55%" stopColor="#DDE2E5" stopOpacity={0.1 * glow} />
            <Stop offset="100%" stopColor="#DDE2E5" stopOpacity={0} />
          </RadialGradient>
        </Defs>
        <Circle cx={50} cy={50} r={50} fill="url(#chromeHalo)" />
      </Svg>
      <Image
        source={source}
        style={{ width: size, height: size }}
        contentFit="contain"
        transition={0}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    alignItems: "center",
    justifyContent: "center",
  },
  halo: {
    position: "absolute",
  },
});
