import type { SVGProps } from "react";

export type SubscriptionCancelIconProps = Omit<SVGProps<SVGSVGElement>, "color"> & { size?: "sm" | "md" | "lg"; variant?: "default" | "inherit" | "muted" | "accent" | "danger" | "inverse" };
const sizes = { sm: 16, md: 20, lg: 24 };
const colors = { default: "var(--vui-color-text)", inherit: "currentColor", muted: "var(--vui-color-muted)", accent: "var(--vui-color-accent)", danger: "var(--vui-color-danger)", inverse: "var(--vui-color-page)" };
export function SubscriptionCancelIcon({ size = "md", variant = "inherit", strokeWidth = 1.4, ...props }: SubscriptionCancelIconProps) {
  return <svg width={sizes[size]} height={sizes[size]} viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false" {...props}>
    <path d="M19.5 8A8 8 0 0 0 5 6L3 9m0-5v5h5M3.5 14A8 8 0 0 0 12 20m3-5 6 6m0-6-6 6" stroke={colors[variant]} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" />
  </svg>;
}
