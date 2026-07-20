import type { SVGProps } from "react";
export type ChevronLeftIconVariant = "default" | "inherit" | "muted" | "accent" | "danger" | "inverse";
export type ChevronLeftIconSize = "sm" | "md" | "lg";
export type ChevronLeftIconProps = Omit<SVGProps<SVGSVGElement>, "color"> & {
  variant?: ChevronLeftIconVariant;
  size?: ChevronLeftIconSize;
};
const sizes: Record<ChevronLeftIconSize, number> = { sm: 16, md: 20, lg: 24 };
const colors: Record<ChevronLeftIconVariant, string> = {
  default: "var(--vui-color-text)",
  inherit: "currentColor",
  muted: "var(--vui-color-muted)",
  accent: "var(--vui-color-accent)",
  danger: "var(--vui-color-danger)",
  inverse: "var(--vui-color-page)",
};
export function ChevronLeftIcon({ variant = "inherit", size = "md", strokeWidth = 1.4, ...props }: ChevronLeftIconProps) {
  const pixelSize = sizes[size];
  return (
    <svg width={pixelSize} height={pixelSize} viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false" {...props}>
      <path d="m15 18-6-6 6-6" stroke={colors[variant]} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
