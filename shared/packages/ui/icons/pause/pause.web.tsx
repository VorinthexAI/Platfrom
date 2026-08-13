import type { SVGProps } from "react";
export type PauseIconVariant = "default" | "inherit" | "muted" | "accent" | "danger" | "inverse";
export type PauseIconSize = "sm" | "md" | "lg";
export type PauseIconProps = Omit<SVGProps<SVGSVGElement>, "color"> & { variant?: PauseIconVariant; size?: PauseIconSize };
const sizes: Record<PauseIconSize, number> = { sm: 16, md: 20, lg: 24 };
const colors: Record<PauseIconVariant, string> = { default: "var(--vui-color-text)", inherit: "currentColor", muted: "var(--vui-color-muted)", accent: "var(--vui-color-accent)", danger: "var(--vui-color-danger)", inverse: "var(--vui-color-page)" };
export function PauseIcon({ variant = "inherit", size = "md", strokeWidth = 1.8, ...props }: PauseIconProps) {
  return <svg width={sizes[size]} height={sizes[size]} viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false" {...props}><path d="M9 6v12M15 6v12" stroke={colors[variant]} strokeWidth={strokeWidth} strokeLinecap="round" /></svg>;
}
