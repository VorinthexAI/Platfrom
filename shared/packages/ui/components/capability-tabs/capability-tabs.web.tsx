import { Tabs, TabsList, TabsTrigger } from "../tabs/tabs.web";

export type CapabilityMode = "chat" | "image" | "video" | "speech";
const coreModes = ["chat", "image", "video", "speech"] as const;

export function CapabilityTabs<T extends string = CapabilityMode>({ value, onValueChange, disabled = false, modes, label = "Choose Core mode" }: { value: T; onValueChange: (value: T) => void; disabled?: boolean; modes?: readonly T[]; label?: string }) {
  const items = modes ?? (coreModes as unknown as readonly T[]);
  return <Tabs onValueChange={(next) => onValueChange(next as T)} value={value}>
    <TabsList aria-label={label} style={{ display: "flex", marginTop: 8 }}>
      {items.map((mode) => <TabsTrigger disabled={disabled} key={mode} style={{ flex: 1 }} value={mode}>{mode[0]!.toUpperCase() + mode.slice(1)}</TabsTrigger>)}
    </TabsList>
  </Tabs>;
}
