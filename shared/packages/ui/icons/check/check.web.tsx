import type { SVGProps } from "react";
export type CheckIconVariant = "default" | "inherit" | "muted" | "accent" | "danger" | "inverse";
export type CheckIconSize = "sm" | "md" | "lg";
export type CheckIconProps = Omit<SVGProps<SVGSVGElement>, "color"> & {
  variant?: CheckIconVariant;
  size?: CheckIconSize;
};
const sizes: Record<CheckIconSize, number> = { sm: 16, md: 20, lg: 24 };
const colors: Record<CheckIconVariant, string> = {
  default: "var(--vui-color-text)",
  inherit: "currentColor",
  muted: "var(--vui-color-muted)",
  accent: "var(--vui-color-accent)",
  danger: "var(--vui-color-danger)",
  inverse: "var(--vui-color-page)",
};
export function CheckIcon({ variant = "inherit", size = "md", strokeWidth = 1.4, ...props }: CheckIconProps) {
  const pixelSize = sizes[size];
  return (
    <svg width={pixelSize} height={pixelSize} viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false" {...props}>
      <path d="m5 12.5 4.5 4.5L19 7" stroke={colors[variant]} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
