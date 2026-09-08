import type { SVGProps } from "react";

export type SwitchTeamIconVariant = "default" | "inherit" | "muted" | "accent" | "danger" | "inverse";
export type SwitchTeamIconSize = "sm" | "md" | "lg";
export type SwitchTeamIconProps = Omit<SVGProps<SVGSVGElement>, "color"> & { variant?: SwitchTeamIconVariant; size?: SwitchTeamIconSize };

const sizes: Record<SwitchTeamIconSize, number> = { sm: 16, md: 20, lg: 24 };
const colors: Record<SwitchTeamIconVariant, string> = {
  default: "var(--vui-color-text)",
  inherit: "currentColor",
  muted: "var(--vui-color-muted)",
  accent: "var(--vui-color-accent)",
  danger: "var(--vui-color-danger)",
  inverse: "var(--vui-color-page)",
};

export function SwitchTeamIcon({ variant = "inherit", size = "md", strokeWidth = 1.4, ...props }: SwitchTeamIconProps) {
  const pixelSize = sizes[size];
  const color = colors[variant];
  return (
    <svg width={pixelSize} height={pixelSize} viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false" {...props}>
      <circle cx="7" cy="7" r="3" stroke={color} strokeWidth={strokeWidth} />
      <circle cx="17" cy="17" r="3" stroke={color} strokeWidth={strokeWidth} />
      <path d="M2.5 16v-1A4.5 4.5 0 0 1 7 10.5c1.15 0 2.2.43 3 1.13M21.5 8V7A4.5 4.5 0 0 0 17 2.5c-1.15 0-2.2.43-3 1.13" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" />
      <path d="M11 6.5h4.5L14 5M13 17.5H8.5L10 19" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
