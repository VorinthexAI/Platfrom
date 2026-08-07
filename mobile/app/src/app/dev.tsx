import { StyleSheet, View } from "react-native";

import { HomeConstellation } from "@/components/HomeConstellation";
import { CAPABILITIES } from "@/data/registry";
import { palette } from "@/theme/tokens";

const ALL_SLUGS = CAPABILITIES.map((capability) => capability.slug);

/**
 * Hidden verification route: personal AI home with every capability enabled.
 */
export default function DevRoute() {
  return (
    <View style={styles.root}>
      <HomeConstellation enabledSlugs={ALL_SLUGS} onOpen={() => {}} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: palette.page,
  },
});
