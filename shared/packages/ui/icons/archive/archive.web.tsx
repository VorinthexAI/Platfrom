import type { SVGProps } from "react";
export type ArchiveIconVariant = "default" | "inherit" | "muted" | "accent" | "danger" | "inverse";
export type ArchiveIconSize = "sm" | "md" | "lg";
export type ArchiveIconProps = Omit<SVGProps<SVGSVGElement>, "color"> & {
  variant?: ArchiveIconVariant;
  size?: ArchiveIconSize;
};
const sizes: Record<ArchiveIconSize, number> = { sm: 16, md: 20, lg: 24 };
const colors: Record<ArchiveIconVariant, string> = {
  default: "var(--vui-color-text)",
  inherit: "currentColor",
  muted: "var(--vui-color-muted)",
  accent: "var(--vui-color-accent)",
  danger: "var(--vui-color-danger)",
  inverse: "var(--vui-color-page)",
};
export function ArchiveIcon({ variant = "inherit", size = "md", strokeWidth = 1.5, ...props }: ArchiveIconProps) {
  const pixelSize = sizes[size];
  return (
    <svg width={pixelSize} height={pixelSize} viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false" {...props}>
      <rect x="3" y="4" width="18" height="5" rx="1" stroke={colors[variant]} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" />
      <path d="M5 9v9a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V9" stroke={colors[variant]} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" />
      <path d="M10 13h4" stroke={colors[variant]} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
