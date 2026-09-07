import type { SVGProps } from "react";

export type ReferralIconVariant = "default" | "inherit" | "muted" | "accent" | "danger" | "inverse";
export type ReferralIconSize = "sm" | "md" | "lg";
export type ReferralIconProps = Omit<SVGProps<SVGSVGElement>, "color"> & { variant?: ReferralIconVariant; size?: ReferralIconSize };

const sizes: Record<ReferralIconSize, number> = { sm: 16, md: 20, lg: 24 };
const colors: Record<ReferralIconVariant, string> = {
  default: "var(--vui-color-text)",
  inherit: "currentColor",
  muted: "var(--vui-color-muted)",
  accent: "var(--vui-color-accent)",
  danger: "var(--vui-color-danger)",
  inverse: "var(--vui-color-page)",
};

export function ReferralIcon({ variant = "inherit", size = "md", strokeWidth = 1.4, ...props }: ReferralIconProps) {
  const pixelSize = sizes[size];
  const color = colors[variant];
  return <svg aria-hidden="true" fill="none" focusable="false" height={pixelSize} viewBox="0 0 24 24" width={pixelSize} {...props}>
    <circle cx="7" cy="8" r="3" stroke={color} strokeWidth={strokeWidth} />
    <circle cx="17" cy="8" r="3" stroke={color} strokeWidth={strokeWidth} />
    <path d="M2.5 20v-1.5A4.5 4.5 0 0 1 7 14h1.5M21.5 20v-1.5A4.5 4.5 0 0 0 17 14h-1.5M9 18h6m-2.5-2.5L15 18l-2.5 2.5" stroke={color} strokeLinecap="round" strokeLinejoin="round" strokeWidth={strokeWidth} />
  </svg>;
}
