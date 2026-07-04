import type { HTMLAttributes } from "react";
export type CommandPaletteProps = HTMLAttributes<HTMLDivElement>;
export function CommandPalette({ className = "", ...props }: CommandPaletteProps) {
  return <div className={["vui-command-palette", className].filter(Boolean).join(" ")} {...props} />;
}
