import { createContext, useContext, useState, type ReactNode } from "react";
import { StyleSheet, View, type ViewProps } from "react-native";
import { Button, ButtonSizeProvider, type ButtonProps } from "../button/button.mobile";

type TabsContextValue = { onValueChange?: (value: string) => void; value?: string };
const TabsContext = createContext<TabsContextValue>({});

export type TabsProps = ViewProps & { children?: ReactNode; defaultValue?: string; onValueChange?: (value: string) => void; value?: string };
export function Tabs({ children, defaultValue, onValueChange, style, value, ...props }: TabsProps) {
  const [internalValue, setInternalValue] = useState(defaultValue);
  const selectedValue = value ?? internalValue;
  const select = (nextValue: string) => {
    if (value === undefined) setInternalValue(nextValue);
    onValueChange?.(nextValue);
  };
  return <TabsContext.Provider value={{ onValueChange: select, value: selectedValue }}><ButtonSizeProvider overrideParent size="xs"><View style={[styles.list, style]} {...props}>{children}</View></ButtonSizeProvider></TabsContext.Provider>;
}

export type TabsListProps = ViewProps & { children?: ReactNode };
export function TabsList({ children, style, ...props }: TabsListProps) {
  return <ButtonSizeProvider overrideParent size="xs"><View accessibilityRole="tablist" style={[styles.list, style]} {...props}>{children}</View></ButtonSizeProvider>;
}

export type TabsTriggerProps = Omit<ButtonProps, "accessibilityRole" | "accessibilityState" | "onPress" | "variant"> & { value: string };
export function TabsTrigger({ value, ...props }: TabsTriggerProps) {
  const tabs = useContext(TabsContext);
  const selected = tabs.value === value;
  return <Button accessibilityRole="tab" accessibilityState={{ selected }} onPress={() => tabs.onValueChange?.(value)} variant={selected ? "secondary" : "ghost"} {...props} />;
}

export type TabsContentProps = ViewProps & { children?: ReactNode; value: string };
export function TabsContent({ value, ...props }: TabsContentProps) {
  const tabs = useContext(TabsContext);
  return tabs.value === value ? <View {...props} /> : null;
}

const styles = StyleSheet.create({
  list: {
    borderColor: "#262D36",
    borderRadius: 999,
  },
});
