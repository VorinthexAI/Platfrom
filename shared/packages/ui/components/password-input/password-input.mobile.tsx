import {
  StyleSheet,
  TextInput,
  type TextInputProps,
} from "react-native";

import { colors, radii } from "../../tokens";

export type PasswordInputProps = TextInputProps;

export function PasswordInput({
  placeholderTextColor = colors.muted,
  style,
  ...props
}: PasswordInputProps) {
  return (
    <TextInput
      placeholderTextColor={placeholderTextColor}
      secureTextEntry
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
