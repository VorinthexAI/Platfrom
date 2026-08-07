import { useState } from "react";
import { StyleSheet, TextInput, View, type StyleProp, type ViewStyle } from "react-native";
import { MicrophoneIcon, SearchIcon } from "@vorinthex/shared/ui/icons-mobile";

import { fonts, palette, radii } from "@/theme/tokens";

export type SearchBarProps = {
  mode?: "prompt" | "search";
  placeholder: string;
  style?: StyleProp<ViewStyle>;
};

/** Local-only text field with search or voice-prompt chrome. */
export function SearchBar({ mode = "search", placeholder, style }: SearchBarProps) {
  const [value, setValue] = useState("");
  return (
    <View style={[styles.root, style]}>
      {mode === "search" ? <SearchIcon size="sm" variant="muted" /> : null}
      <TextInput
        value={value}
        onChangeText={setValue}
        placeholder={placeholder}
        placeholderTextColor={palette.silver500}
        selectionColor={palette.silver300}
        style={styles.input}
        accessibilityLabel={placeholder}
      />
      {mode === "prompt" ? <MicrophoneIcon size="sm" variant="accent" /> : null}
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
