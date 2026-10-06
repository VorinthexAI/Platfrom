import type { SVGProps } from "react";

export type RestorePurchasesIconProps = Omit<SVGProps<SVGSVGElement>, "color"> & { size?: "sm" | "md" | "lg"; variant?: "default" | "inherit" | "muted" | "accent" | "danger" | "inverse" };
const sizes = { sm: 16, md: 20, lg: 24 };
const colors = { default: "var(--vui-color-text)", inherit: "currentColor", muted: "var(--vui-color-muted)", accent: "var(--vui-color-accent)", danger: "var(--vui-color-danger)", inverse: "var(--vui-color-page)" };
export function RestorePurchasesIcon({ size = "md", variant = "inherit", strokeWidth = 1.4, ...props }: RestorePurchasesIconProps) {
  return <svg width={sizes[size]} height={sizes[size]} viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false" {...props}>
    <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8M3 3v5h5" stroke={colors[variant]} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" />
  </svg>;
}
