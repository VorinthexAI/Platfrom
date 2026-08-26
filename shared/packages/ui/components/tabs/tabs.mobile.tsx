import type { ReactNode } from "react";
import { StyleSheet, View, type ViewProps } from "react-native";
import { ButtonSizeProvider } from "../button/button.mobile";

export type TabsProps = ViewProps & { children?: ReactNode };
export function Tabs({ children, style, ...props }: TabsProps) {
  return <ButtonSizeProvider size="xs"><View style={[styles.root, style]} {...props}>{children}</View></ButtonSizeProvider>;
}
const styles = StyleSheet.create({
  root: {
    borderColor: "#262D36",
    borderRadius: 999,
  },
});
