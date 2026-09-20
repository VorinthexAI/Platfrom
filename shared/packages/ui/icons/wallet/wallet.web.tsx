import type { SVGProps } from "react";

export type WalletIconVariant = "default" | "inherit" | "muted" | "accent" | "danger" | "inverse";
export type WalletIconSize = "sm" | "md" | "lg";
export type WalletIconProps = Omit<SVGProps<SVGSVGElement>, "color"> & { variant?: WalletIconVariant; size?: WalletIconSize };

const sizes: Record<WalletIconSize, number> = { sm: 16, md: 20, lg: 24 };
const colors: Record<WalletIconVariant, string> = {
  default: "var(--vui-color-text)",
  inherit: "currentColor",
  muted: "var(--vui-color-muted)",
  accent: "var(--vui-color-accent)",
  danger: "var(--vui-color-danger)",
  inverse: "var(--vui-color-page)",
};

export function WalletIcon({ variant = "inherit", size = "md", strokeWidth = 1.4, ...props }: WalletIconProps) {
  const pixelSize = sizes[size];
  const color = colors[variant];
  return <svg aria-hidden="true" fill="none" focusable="false" height={pixelSize} viewBox="0 0 24 24" width={pixelSize} {...props}>
    <path d="M4.5 8.5V7.25A1.75 1.75 0 0 1 6.25 5.5h11.5A1.75 1.75 0 0 1 19.5 7.25V8.5" stroke={color} strokeLinecap="round" strokeLinejoin="round" strokeWidth={strokeWidth} />
    <rect height="11" rx="1.75" stroke={color} strokeWidth={strokeWidth} width="16" x="4" y="8.5" />
    <path d="M16 14h3.5A1.5 1.5 0 0 0 21 12.5v-1A1.5 1.5 0 0 0 19.5 10H16a1.5 1.5 0 0 0 0 4Z" stroke={color} strokeLinejoin="round" strokeWidth={strokeWidth} />
  </svg>;
}
