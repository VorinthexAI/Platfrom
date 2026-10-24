import { StyleSheet } from "react-native";
import { Tabs, TabsTrigger } from "../tabs/tabs.mobile";

export type CapabilityMode = "chat" | "image" | "video" | "speech";
const coreModes = ["chat", "image", "video", "speech"] as const;

export function CapabilityTabs<T extends string = CapabilityMode>({ value, onValueChange, disabled = false, modes, label = "Choose Core mode" }: { value: T; onValueChange: (value: T) => void; disabled?: boolean; modes?: readonly T[]; label?: string }) {
  const items = modes ?? (coreModes as unknown as readonly T[]);
  return <Tabs accessibilityLabel={label} accessibilityRole="tablist" onValueChange={(next) => onValueChange(next as T)} style={styles.list} value={value}>
    {items.map((mode) => <TabsTrigger disabled={disabled} key={mode} style={styles.trigger} value={mode}>{mode[0]!.toUpperCase() + mode.slice(1)}</TabsTrigger>)}
  </Tabs>;
}

const styles = StyleSheet.create({ list: { alignSelf: "stretch", marginTop: 8 }, trigger: { flex: 1 } });
