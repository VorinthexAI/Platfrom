import { forwardRef } from "react";
import {
  StyleSheet,
  TextInput as NativeTextInput,
  type TextInputProps as NativeTextInputProps,
} from "react-native";

import { colors, radii } from "../../tokens";

export type TextInputProps = NativeTextInputProps;

export const TextInput = forwardRef<NativeTextInput, TextInputProps>(function TextInput(
  {
    placeholderTextColor = colors.muted,
    style,
    ...props
  },
  ref,
) {
  return (
    <NativeTextInput
      placeholderTextColor={placeholderTextColor}
      ref={ref}
      style={[styles.input, style]}
      {...props}
    />
  );
});

const styles = StyleSheet.create({
  input: {
    backgroundColor: colors.panel,
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
});
