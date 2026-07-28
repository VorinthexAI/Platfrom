import type { SVGProps } from "react";
export type MoreHorizontalIconVariant = "default" | "inherit" | "muted" | "accent" | "danger" | "inverse";
export type MoreHorizontalIconSize = "sm" | "md" | "lg";
export type MoreHorizontalIconProps = Omit<SVGProps<SVGSVGElement>, "color"> & {
  variant?: MoreHorizontalIconVariant;
  size?: MoreHorizontalIconSize;
};
const sizes: Record<MoreHorizontalIconSize, number> = { sm: 16, md: 20, lg: 24 };
const colors: Record<MoreHorizontalIconVariant, string> = {
  default: "var(--vui-color-text)",
  inherit: "currentColor",
  muted: "var(--vui-color-muted)",
  accent: "var(--vui-color-accent)",
  danger: "var(--vui-color-danger)",
  inverse: "var(--vui-color-page)",
};
export function MoreHorizontalIcon({ variant = "inherit", size = "md", strokeWidth = 1.4, ...props }: MoreHorizontalIconProps) {
  const pixelSize = sizes[size];
  return (
    <svg width={pixelSize} height={pixelSize} viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false" {...props}>
      <circle cx="5" cy="12" r={strokeWidth} fill={colors[variant]} />
      <circle cx="12" cy="12" r={strokeWidth} fill={colors[variant]} />
      <circle cx="19" cy="12" r={strokeWidth} fill={colors[variant]} />
    </svg>
  );
}
