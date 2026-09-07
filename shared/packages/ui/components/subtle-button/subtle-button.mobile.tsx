import type { ComponentProps } from "react";
import { StyleSheet } from "react-native";

import { Button } from "../button/button.mobile";

export type SubtleButtonProps = Omit<ComponentProps<typeof Button>, "variant">;

export function SubtleButton({ size = "md", style, textStyle, ...props }: SubtleButtonProps) {
  return (
    <Button
      size={size}
      style={(state) => [styles.button, typeof style === "function" ? style(state) : style]}
      textStyle={[styles.text, textStyle]}
      variant="ghost"
      {...props}
    />
  );
}

const styles = StyleSheet.create({
  button: { backgroundColor: "transparent", borderColor: "transparent" },
  text: { color: "#7B858C", letterSpacing: 0.4 },
});
