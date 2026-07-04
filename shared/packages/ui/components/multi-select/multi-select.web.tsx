import type { HTMLAttributes } from "react";
export type MultiSelectProps = HTMLAttributes<HTMLDivElement>;
export function MultiSelect({ className = "", ...props }: MultiSelectProps) {
  return <div className={["vui-multi-select", className].filter(Boolean).join(" ")} {...props} />;
}
