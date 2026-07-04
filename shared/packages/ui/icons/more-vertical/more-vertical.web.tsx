import type { SVGProps } from "react";
export type MoreVerticalIconVariant = "default" | "muted" | "accent" | "danger" | "inverse";
export type MoreVerticalIconSize = "sm" | "md" | "lg";
export type MoreVerticalIconProps = Omit<SVGProps<SVGSVGElement>, "color"> & {
  variant?: MoreVerticalIconVariant;
  size?: MoreVerticalIconSize;
};
const sizes: Record<MoreVerticalIconSize, number> = { sm: 16, md: 20, lg: 24 };
const colors: Record<MoreVerticalIconVariant, string> = {
  default: "var(--vui-color-text)",
  muted: "var(--vui-color-muted)",
  accent: "var(--vui-color-accent)",
  danger: "var(--vui-color-danger)",
  inverse: "var(--vui-color-page)",
};
export function MoreVerticalIcon({ variant = "default", size = "md", strokeWidth = 1.4, ...props }: MoreVerticalIconProps) {
  const pixelSize = sizes[size];
  return (
    <svg width={pixelSize} height={pixelSize} viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false" {...props}>
      <path d="M5 12h14" stroke={colors[variant]} strokeWidth={strokeWidth} strokeLinecap="round" />
      <path d="M12 5v14" stroke={colors[variant]} strokeWidth={strokeWidth} strokeLinecap="round" />
    </svg>
  );
}
