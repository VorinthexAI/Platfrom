import { useState } from "react";
import { StyleSheet, TextInput, View, type StyleProp, type ViewStyle } from "react-native";
import { SearchIcon } from "@vorinthex/shared/ui/icons-mobile";

import { fonts, palette, radii } from "@/theme/tokens";

export type SearchBarProps = {
  placeholder: string;
  style?: StyleProp<ViewStyle>;
};

/** Visual search field — local state only, wired to nothing in this mockup. */
export function SearchBar({ placeholder, style }: SearchBarProps) {
  const [value, setValue] = useState("");
  return (
    <View style={[styles.root, style]}>
      <SearchIcon size="sm" variant="muted" />
      <TextInput
        value={value}
        onChangeText={setValue}
        placeholder={placeholder}
        placeholderTextColor={palette.silver500}
        selectionColor={palette.silver300}
        style={styles.input}
        accessibilityLabel={placeholder}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: palette.panelRaised,
    borderWidth: 1,
    borderColor: palette.hairline,
    borderRadius: radii.md,
    paddingHorizontal: 14,
    height: 46,
  },
  input: {
    flex: 1,
    color: palette.silver100,
    fontFamily: fonts.regular,
    fontSize: 14,
    paddingVertical: 0,
  },
});
