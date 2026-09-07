import type { SVGProps } from "react";
export type BellIconVariant = "default" | "inherit" | "muted" | "accent" | "danger" | "inverse";
export type BellIconSize = "sm" | "md" | "lg";
export type BellIconProps = Omit<SVGProps<SVGSVGElement>, "color"> & {
  variant?: BellIconVariant;
  size?: BellIconSize;
};
const sizes: Record<BellIconSize, number> = { sm: 16, md: 20, lg: 24 };
const colors: Record<BellIconVariant, string> = {
  default: "var(--vui-color-text)",
  inherit: "currentColor",
  muted: "var(--vui-color-muted)",
  accent: "var(--vui-color-accent)",
  danger: "var(--vui-color-danger)",
  inverse: "var(--vui-color-page)",
};
export function BellIcon({ variant = "inherit", size = "md", strokeWidth = 1.4, ...props }: BellIconProps) {
  const pixelSize = sizes[size];
  return (
    <svg width={pixelSize} height={pixelSize} viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false" {...props}>
      <path d="M18 9a6 6 0 0 0-12 0c0 6-3 7-3 7h18s-3-1-3-7Z" stroke={colors[variant]} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" />
      <path d="M14.2 20a2.4 2.4 0 0 1-4.4 0" stroke={colors[variant]} strokeWidth={strokeWidth} strokeLinecap="round" />
    </svg>
  );
}
