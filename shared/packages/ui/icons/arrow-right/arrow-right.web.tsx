import type { SVGProps } from "react";
export type ArrowRightIconVariant = "default" | "inherit" | "muted" | "accent" | "danger" | "inverse";
export type ArrowRightIconSize = "sm" | "md" | "lg";
export type ArrowRightIconProps = Omit<SVGProps<SVGSVGElement>, "color"> & {
  variant?: ArrowRightIconVariant;
  size?: ArrowRightIconSize;
};
const sizes: Record<ArrowRightIconSize, number> = { sm: 16, md: 20, lg: 24 };
const colors: Record<ArrowRightIconVariant, string> = {
  default: "var(--vui-color-text)",
  inherit: "currentColor",
  muted: "var(--vui-color-muted)",
  accent: "var(--vui-color-accent)",
  danger: "var(--vui-color-danger)",
  inverse: "var(--vui-color-page)",
};
export function ArrowRightIcon({ variant = "inherit", size = "md", strokeWidth = 1.4, ...props }: ArrowRightIconProps) {
  const pixelSize = sizes[size];
  return (
    <svg width={pixelSize} height={pixelSize} viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false" {...props}>
      <path d="M5 12h14" stroke={colors[variant]} strokeWidth={strokeWidth} strokeLinecap="round" />
      <path d="m13 6 6 6-6 6" stroke={colors[variant]} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
