import type { HTMLAttributes } from "react";
export type SettingsPanelProps = HTMLAttributes<HTMLDivElement>;
export function SettingsPanel({ className = "", ...props }: SettingsPanelProps) {
  return <div className={["vui-settings-panel", className].filter(Boolean).join(" ")} {...props} />;
}
