import { StyleSheet } from "react-native";
import { Tabs, TabsTrigger } from "../tabs/tabs.mobile";

export type CapabilityMode = "chat" | "image" | "video" | "speech";
export type CapabilityTabsProps = { value: CapabilityMode; onValueChange: (value: CapabilityMode) => void; disabled?: boolean };
const modes: readonly CapabilityMode[] = ["chat", "image", "video", "speech"];

export function CapabilityTabs({ value, onValueChange, disabled = false }: CapabilityTabsProps) {
  return <Tabs accessibilityLabel="Choose Core mode" accessibilityRole="tablist" onValueChange={(next) => onValueChange(next as CapabilityMode)} style={styles.list} value={value}>
    {modes.map((mode) => <TabsTrigger disabled={disabled} key={mode} style={styles.trigger} value={mode}>{mode[0]!.toUpperCase() + mode.slice(1)}</TabsTrigger>)}
  </Tabs>;
}

const styles = StyleSheet.create({ list: { alignSelf: "stretch", marginTop: 8 }, trigger: { flex: 1 } });
