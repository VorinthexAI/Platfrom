import type { SVGProps } from "react";
export type AscendIconVariant = "default" | "inherit" | "muted" | "accent" | "danger" | "inverse";
export type AscendIconSize = "sm" | "md" | "lg";
export type AscendIconProps = Omit<SVGProps<SVGSVGElement>, "color"> & {
  variant?: AscendIconVariant;
  size?: AscendIconSize;
};
const sizes: Record<AscendIconSize, number> = { sm: 16, md: 20, lg: 24 };
const colors: Record<AscendIconVariant, string> = {
  default: "var(--vui-color-text)",
  inherit: "currentColor",
  muted: "var(--vui-color-muted)",
  accent: "var(--vui-color-accent)",
  danger: "var(--vui-color-danger)",
  inverse: "var(--vui-color-page)",
};
export function AscendIcon({ variant = "inherit", size = "md", strokeWidth = 1.5, ...props }: AscendIconProps) {
  const pixelSize = sizes[size];
  return (
    <svg width={pixelSize} height={pixelSize} viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false" {...props}>
      <path d="M4 19h16" stroke={colors[variant]} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" />
      <path d="m5 15 4.5-4.5 3 3L19 7" stroke={colors[variant]} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" />
      <path d="M15 7h4v4" stroke={colors[variant]} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
