import type { SVGProps } from "react";

export type DeleteAccountIconVariant = "default" | "inherit" | "muted" | "accent" | "danger" | "inverse";
export type DeleteAccountIconSize = "sm" | "md" | "lg";
export type DeleteAccountIconProps = Omit<SVGProps<SVGSVGElement>, "color"> & { variant?: DeleteAccountIconVariant; size?: DeleteAccountIconSize };

const sizes: Record<DeleteAccountIconSize, number> = { sm: 16, md: 20, lg: 24 };
const colors: Record<DeleteAccountIconVariant, string> = {
  default: "var(--vui-color-text)",
  inherit: "currentColor",
  muted: "var(--vui-color-muted)",
  accent: "var(--vui-color-accent)",
  danger: "var(--vui-color-danger)",
  inverse: "var(--vui-color-page)",
};

export function DeleteAccountIcon({ variant = "inherit", size = "md", strokeWidth = 1.4, ...props }: DeleteAccountIconProps) {
  const pixelSize = sizes[size];
  const color = colors[variant];
  return (
    <svg width={pixelSize} height={pixelSize} viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false" {...props}>
      <circle cx="9" cy="7.5" r="3.5" stroke={color} strokeWidth={strokeWidth} />
      <path d="M3.5 20v-2a5.5 5.5 0 0 1 9.6-3.65" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" />
      <circle cx="17.5" cy="17.5" r="3.5" stroke={color} strokeWidth={strokeWidth} />
      <path d="m16 16 3 3M19 16l-3 3" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" />
    </svg>
  );
}
