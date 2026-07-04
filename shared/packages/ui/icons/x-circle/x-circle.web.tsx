import type { SVGProps } from "react";
export type XCircleIconVariant = "default" | "muted" | "accent" | "danger" | "inverse";
export type XCircleIconSize = "sm" | "md" | "lg";
export type XCircleIconProps = Omit<SVGProps<SVGSVGElement>, "color"> & {
  variant?: XCircleIconVariant;
  size?: XCircleIconSize;
};
const sizes: Record<XCircleIconSize, number> = { sm: 16, md: 20, lg: 24 };
const colors: Record<XCircleIconVariant, string> = {
  default: "var(--vui-color-text)",
  muted: "var(--vui-color-muted)",
  accent: "var(--vui-color-accent)",
  danger: "var(--vui-color-danger)",
  inverse: "var(--vui-color-page)",
};
export function XCircleIcon({ variant = "default", size = "md", strokeWidth = 1.4, ...props }: XCircleIconProps) {
  const pixelSize = sizes[size];
  return (
    <svg width={pixelSize} height={pixelSize} viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false" {...props}>
      <path d="M5 12h14" stroke={colors[variant]} strokeWidth={strokeWidth} strokeLinecap="round" />
      <path d="M12 5v14" stroke={colors[variant]} strokeWidth={strokeWidth} strokeLinecap="round" />
    </svg>
  );
}
