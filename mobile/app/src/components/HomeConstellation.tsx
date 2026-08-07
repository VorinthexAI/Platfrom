import {
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  View,
  type LayoutChangeEvent,
} from "react-native";
import { useCallback, useEffect, useState } from "react";
import Animated, { FadeIn } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Button } from "@vorinthex/shared/ui/button";

import { ChromeIcon } from "@/components/ChromeIcon";
import { SearchBar } from "@/components/SearchBar";
import { PersonalAIStar3D } from "@/components/three/PersonalAIStar3D";
import { capabilityIconSource, vorinthexMarkSource } from "@/data/capability-icons";
import { CAPABILITIES, type CapabilitySlug } from "@/data/registry";
import { fonts, palette, tracking } from "@/theme/tokens";

const CORE_SIZE = 144;
const PROMPT_KEYBOARD_GAP = 10;
const NODE_POSITIONS: Record<
  CapabilitySlug,
  { top: `${number}%`; left: `${number}%` }
> = {
  archive: { top: "30%", left: "8%" },
  gallery: { top: "30%", left: "72%" },
  signal: { top: "60%", left: "5%" },
  compass: { top: "60%", left: "75%" },
  ascend: { top: "75.5%", left: "40%" },
};

export type HomeConstellationProps = {
  enabledSlugs: readonly CapabilitySlug[];
  onOpen: (slug: CapabilitySlug) => void;
};

/** Personal AI home: a neural star connects each enabled capability. */
export function HomeConstellation({
  enabledSlugs,
  onOpen,
}: HomeConstellationProps) {
  const insets = useSafeAreaInsets();
  const [keyboardVisible, setKeyboardVisible] = useState(() =>
    Keyboard.isVisible(),
  );
  const [sceneSize, setSceneSize] = useState({ width: 0, height: 0 });
  const captureFullSceneSize = useCallback((event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout;
    setSceneSize((current) => {
      const next = {
        width: Math.max(current.width, width),
        height: Math.max(current.height, height),
      };
      return next.width === current.width && next.height === current.height
        ? current
        : next;
    });
  }, []);
  const capabilities = CAPABILITIES.filter((capability) =>
    enabledSlugs.includes(capability.slug),
  );

  useEffect(() => {
    const showEvent =
      Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow";
    const hideEvent =
      Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide";
    const showSubscription = Keyboard.addListener(showEvent, () =>
      setKeyboardVisible(true),
    );
    const hideSubscription = Keyboard.addListener(hideEvent, () =>
      setKeyboardVisible(false),
    );

    return () => {
      showSubscription.remove();
      hideSubscription.remove();
    };
  }, []);

  return (
    <View onLayout={captureFullSceneSize} style={styles.root}>
      <View style={[styles.scene, sceneSize]}>
        <PersonalAIStar3D style={StyleSheet.absoluteFill} />

        <View pointerEvents="none" style={styles.centerLogo}>
          <ChromeIcon glow={0.9} size={CORE_SIZE} source={vorinthexMarkSource} />
        </View>

        {capabilities.map((capability, index) => (
          <Animated.View
            entering={FadeIn.delay(160 + index * 90).duration(500)}
            key={capability.slug}
            style={[styles.node, NODE_POSITIONS[capability.slug]]}
          >
            <Button
              accessibilityLabel={`Open ${capability.name}`}
              contentMode="raw"
              onPress={() => onOpen(capability.slug)}
              size="lg"
              style={styles.nodeButton}
              variant="icon"
            >
              <ChromeIcon
                glow={0.75}
                size={42}
                source={capabilityIconSource[capability.slug]}
              />
            </Button>
            <Text pointerEvents="none" style={styles.nodeLabel}>
              {capability.name.toUpperCase()}
            </Text>
          </Animated.View>
        ))}
      </View>

      <KeyboardAvoidingView
        behavior="padding"
        pointerEvents="box-none"
        style={styles.promptLayer}
      >
        <SearchBar
          mode="prompt"
          placeholder="Ask Core anything..."
          style={[
            styles.prompt,
            {
              marginBottom: keyboardVisible
                ? PROMPT_KEYBOARD_GAP
                : insets.bottom + 14,
            },
          ]}
        />
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    backgroundColor: palette.page,
  },
  scene: {
    position: "absolute",
    top: 0,
    left: 0,
    backgroundColor: palette.page,
  },
  centerLogo: {
    position: "absolute",
    top: "49%",
    left: 0,
    right: 0,
    alignItems: "center",
    transform: [{ translateY: -CORE_SIZE / 2 }],
  },
  node: {
    position: "absolute",
    width: 78,
    alignItems: "center",
  },
  nodeButton: {
    borderColor: "rgba(215, 235, 245, 0.28)",
    backgroundColor: "rgba(5, 9, 12, 0.82)",
    shadowColor: "#bde9ff",
    shadowOpacity: 0.26,
    shadowRadius: 16,
    elevation: 8,
  },
  nodeLabel: {
    marginTop: 7,
    color: palette.silver300,
    fontFamily: fonts.medium,
    fontSize: 9,
    letterSpacing: tracking.micro,
    paddingLeft: tracking.micro,
  },
  prompt: {
    marginHorizontal: 20,
    height: 44,
    borderRadius: 999,
    backgroundColor: "rgba(9, 13, 17, 0.9)",
    borderColor: "rgba(215, 235, 245, 0.12)",
  },
  promptLayer: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    justifyContent: "flex-end",
  },
});
