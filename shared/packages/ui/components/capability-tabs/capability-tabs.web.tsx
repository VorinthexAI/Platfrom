import { Tabs, TabsList, TabsTrigger } from "../tabs/tabs.web";

export type CapabilityMode = "chat" | "image" | "video" | "speech";
export type CapabilityTabsProps = { value: CapabilityMode; onValueChange: (value: CapabilityMode) => void; disabled?: boolean };
const modes: readonly CapabilityMode[] = ["chat", "image", "video", "speech"];

export function CapabilityTabs({ value, onValueChange, disabled = false }: CapabilityTabsProps) {
  return <Tabs onValueChange={(next) => onValueChange(next as CapabilityMode)} value={value}>
    <TabsList aria-label="Choose Core mode" style={{ display: "flex", marginTop: 8 }}>
      {modes.map((mode) => <TabsTrigger disabled={disabled} key={mode} style={{ flex: 1 }} value={mode}>{mode[0]!.toUpperCase() + mode.slice(1)}</TabsTrigger>)}
    </TabsList>
  </Tabs>;
}
