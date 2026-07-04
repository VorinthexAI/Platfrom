import type { SVGProps } from "react";
export type CloseIconVariant = "default" | "muted" | "accent" | "danger" | "inverse";
export type CloseIconSize = "sm" | "md" | "lg";
export type CloseIconProps = Omit<SVGProps<SVGSVGElement>, "color"> & {
  variant?: CloseIconVariant;
  size?: CloseIconSize;
};
const sizes: Record<CloseIconSize, number> = { sm: 16, md: 20, lg: 24 };
const colors: Record<CloseIconVariant, string> = {
  default: "var(--vui-color-text)",
  muted: "var(--vui-color-muted)",
  accent: "var(--vui-color-accent)",
  danger: "var(--vui-color-danger)",
  inverse: "var(--vui-color-page)",
};
export function CloseIcon({ variant = "default", size = "md", strokeWidth = 1.4, ...props }: CloseIconProps) {
  const pixelSize = sizes[size];
  return (
    <svg width={pixelSize} height={pixelSize} viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false" {...props}>
      <path d="M5 12h14" stroke={colors[variant]} strokeWidth={strokeWidth} strokeLinecap="round" />
      <path d="M12 5v14" stroke={colors[variant]} strokeWidth={strokeWidth} strokeLinecap="round" />
    </svg>
  );
}
