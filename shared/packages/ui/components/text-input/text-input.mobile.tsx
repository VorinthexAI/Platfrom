import {
  StyleSheet,
  TextInput as NativeTextInput,
  type TextInputProps as NativeTextInputProps,
} from "react-native";

import { colors, radii } from "../../tokens";

export type TextInputProps = NativeTextInputProps;

export function TextInput({
  placeholderTextColor = colors.muted,
  style,
  ...props
}: TextInputProps) {
  return (
    <NativeTextInput
      placeholderTextColor={placeholderTextColor}
      style={[styles.input, style]}
      {...props}
    />
  );
}

const styles = StyleSheet.create({
  input: {
    backgroundColor: colors.page,
    borderColor: colors.border,
    borderRadius: radii.md,
    borderWidth: 1,
    color: colors.text,
    fontFamily: "Fraunces",
    fontSize: 16,
    minHeight: 42,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
});
