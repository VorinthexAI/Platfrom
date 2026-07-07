import type { SVGProps } from "react";
export type CompassIconVariant = "default" | "inherit" | "muted" | "accent" | "danger" | "inverse";
export type CompassIconSize = "sm" | "md" | "lg";
export type CompassIconProps = Omit<SVGProps<SVGSVGElement>, "color"> & {
  variant?: CompassIconVariant;
  size?: CompassIconSize;
};
const sizes: Record<CompassIconSize, number> = { sm: 16, md: 20, lg: 24 };
const colors: Record<CompassIconVariant, string> = {
  default: "var(--vui-color-text)",
  inherit: "currentColor",
  muted: "var(--vui-color-muted)",
  accent: "var(--vui-color-accent)",
  danger: "var(--vui-color-danger)",
  inverse: "var(--vui-color-page)",
};
export function CompassIcon({ variant = "inherit", size = "md", strokeWidth = 1.5, ...props }: CompassIconProps) {
  const pixelSize = sizes[size];
  return (
    <svg width={pixelSize} height={pixelSize} viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false" {...props}>
      <circle cx="12" cy="12" r="9" stroke={colors[variant]} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" />
      <path d="m15.5 8.5-2 5-5 2 2-5z" stroke={colors[variant]} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
