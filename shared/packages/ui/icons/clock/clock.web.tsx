import type { SVGProps } from "react";
export type ClockIconVariant = "default" | "inherit" | "muted" | "accent" | "danger" | "inverse";
export type ClockIconSize = "sm" | "md" | "lg";
export type ClockIconProps = Omit<SVGProps<SVGSVGElement>, "color"> & {
  variant?: ClockIconVariant;
  size?: ClockIconSize;
};
const sizes: Record<ClockIconSize, number> = { sm: 16, md: 20, lg: 24 };
const colors: Record<ClockIconVariant, string> = {
  default: "var(--vui-color-text)",
  inherit: "currentColor",
  muted: "var(--vui-color-muted)",
  accent: "var(--vui-color-accent)",
  danger: "var(--vui-color-danger)",
  inverse: "var(--vui-color-page)",
};
export function ClockIcon({ variant = "inherit", size = "md", strokeWidth = 1.4, ...props }: ClockIconProps) {
  const pixelSize = sizes[size];
  return (
    <svg width={pixelSize} height={pixelSize} viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false" {...props}>
      <circle cx="12" cy="12" r="9" stroke={colors[variant]} strokeWidth={strokeWidth} />
      <path d="M12 7v5l3.5 2" stroke={colors[variant]} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
