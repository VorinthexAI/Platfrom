import { useEffect, useMemo, useState } from "react";
import { StyleSheet, View, useWindowDimensions } from "react-native";
import Animated, {
  Easing,
  FadeIn,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from "react-native-reanimated";

import {
  CAPABILITY_CAROUSEL_HEIGHT,
  CapabilityArcCarousel,
} from "@/components/CapabilityArcCarousel";
import { ChromeIcon } from "@/components/ChromeIcon";
import { NeuralField3D } from "@/components/three/NeuralField3D";
import { capabilityIconSource } from "@/data/capability-icons";
import {
  CAPABILITIES,
  type Capability,
  type CapabilitySlug,
} from "@/data/registry";

const FIELD_SPEED = 0.05;
const CORE_ICON_SIZE = 82;
const CAROUSEL_OVERLAP = 30;

export type HomeConstellationProps = {
  enabledSlugs: readonly CapabilitySlug[];
  onOpen: (slug: CapabilitySlug) => void;
};

/** Neural field with one synchronized core Capability and a wrapped arc carousel. */
export function HomeConstellation({
  enabledSlugs,
  onOpen,
}: HomeConstellationProps) {
  const { width: screenWidth, height: screenHeight } = useWindowDimensions();
  const width = Math.min(screenWidth - 16, 390);
  const fieldHeight = Math.max(270, Math.min(450, screenHeight - 310));
  const capabilities = useMemo(
    () =>
      CAPABILITIES.filter((capability) =>
        enabledSlugs.includes(capability.slug),
      ),
    [enabledSlugs],
  );
  const [selectedIndex, setSelectedIndex] = useState(0);
  const rotation = useSharedValue(0);

  useEffect(() => {
    if (selectedIndex >= capabilities.length) setSelectedIndex(0);
  }, [capabilities.length, selectedIndex]);

  useEffect(() => {
    rotation.value = withRepeat(
      withTiming(1, {
        duration: (Math.PI * 2 * 1000) / FIELD_SPEED,
        easing: Easing.linear,
      }),
      -1,
      false,
    );
  }, [rotation]);

  const coreStyle = useAnimatedStyle(() => ({
    transform: [
      { perspective: 800 },
      { rotateX: "10.3deg" },
      { rotateY: `${rotation.value * 360}deg` },
    ],
  }));

  const selected = capabilities[selectedIndex];
  const open = (capability: Capability) => onOpen(capability.slug);

  return (
    <View style={[styles.root, { width, height: fieldHeight + 154 }]}>
      <View style={[styles.field, { width, height: fieldHeight }]}>
        <NeuralField3D
          seed={31}
          count={110}
          radius={5}
          speed={FIELD_SPEED}
          coreGlow
          style={StyleSheet.absoluteFill}
        />

        {selected ? (
          <Animated.View
            key={selected.slug}
            entering={FadeIn.duration(240)}
            pointerEvents="none"
            style={[
              styles.coreIcon,
              {
                left: width / 2 - CORE_ICON_SIZE / 2,
                top: fieldHeight / 2 - CORE_ICON_SIZE / 2,
              },
              coreStyle,
            ]}
          >
            <ChromeIcon
              source={capabilityIconSource[selected.slug]}
              size={CORE_ICON_SIZE}
              glow={0.68}
            />
          </Animated.View>
        ) : null}
      </View>

      {capabilities.length > 0 ? (
        <View
          pointerEvents="box-none"
          style={[
            styles.carousel,
            {
              top: fieldHeight - CAROUSEL_OVERLAP,
              height: CAPABILITY_CAROUSEL_HEIGHT,
            },
          ]}
        >
          <CapabilityArcCarousel
            capabilities={capabilities}
            selectedIndex={selectedIndex}
            width={width}
            onOpen={open}
            onSelect={setSelectedIndex}
          />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    alignSelf: "center",
  },
  field: {
    position: "absolute",
    top: 0,
    left: 0,
  },
  coreIcon: {
    position: "absolute",
  },
  carousel: {
    position: "absolute",
    left: 0,
    right: 0,
  },
});
