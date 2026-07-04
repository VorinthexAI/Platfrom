import type { SVGProps } from "react";
export type ShareIconVariant = "default" | "muted" | "accent" | "danger" | "inverse";
export type ShareIconSize = "sm" | "md" | "lg";
export type ShareIconProps = Omit<SVGProps<SVGSVGElement>, "color"> & {
  variant?: ShareIconVariant;
  size?: ShareIconSize;
};
const sizes: Record<ShareIconSize, number> = { sm: 16, md: 20, lg: 24 };
const colors: Record<ShareIconVariant, string> = {
  default: "var(--vui-color-text)",
  muted: "var(--vui-color-muted)",
  accent: "var(--vui-color-accent)",
  danger: "var(--vui-color-danger)",
  inverse: "var(--vui-color-page)",
};
export function ShareIcon({ variant = "default", size = "md", strokeWidth = 1.4, ...props }: ShareIconProps) {
  const pixelSize = sizes[size];
  return (
    <svg width={pixelSize} height={pixelSize} viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false" {...props}>
      <path d="M5 12h14" stroke={colors[variant]} strokeWidth={strokeWidth} strokeLinecap="round" />
      <path d="M12 5v14" stroke={colors[variant]} strokeWidth={strokeWidth} strokeLinecap="round" />
    </svg>
  );
}
