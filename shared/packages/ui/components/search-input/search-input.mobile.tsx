import {
  StyleSheet,
  TextInput,
  type TextInputProps,
} from "react-native";

import { colors, radii } from "../../tokens";

export type SearchInputProps = TextInputProps;

export function SearchInput({
  placeholderTextColor = colors.muted,
  style,
  ...props
}: SearchInputProps) {
  return (
    <TextInput
      inputMode="search"
      placeholderTextColor={placeholderTextColor}
      style={[styles.input, style, styles.background]}
      {...props}
    />
  );
}

const styles = StyleSheet.create({
  input: {
    borderColor: colors.border,
    borderRadius: radii.md,
    borderWidth: 1,
    color: colors.text,
    fontFamily: "Geist_400Regular",
    fontSize: 16,
    minHeight: 42,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  background: { backgroundColor: colors.page },
});
