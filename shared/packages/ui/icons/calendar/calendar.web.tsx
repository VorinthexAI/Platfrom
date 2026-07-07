import type { SVGProps } from "react";
export type CalendarIconVariant = "default" | "inherit" | "muted" | "accent" | "danger" | "inverse";
export type CalendarIconSize = "sm" | "md" | "lg";
export type CalendarIconProps = Omit<SVGProps<SVGSVGElement>, "color"> & {
  variant?: CalendarIconVariant;
  size?: CalendarIconSize;
};
const sizes: Record<CalendarIconSize, number> = { sm: 16, md: 20, lg: 24 };
const colors: Record<CalendarIconVariant, string> = {
  default: "var(--vui-color-text)",
  inherit: "currentColor",
  muted: "var(--vui-color-muted)",
  accent: "var(--vui-color-accent)",
  danger: "var(--vui-color-danger)",
  inverse: "var(--vui-color-page)",
};
export function CalendarIcon({ variant = "inherit", size = "md", strokeWidth = 1.4, ...props }: CalendarIconProps) {
  const pixelSize = sizes[size];
  return (
    <svg width={pixelSize} height={pixelSize} viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false" {...props}>
      <path d="M5 12h14" stroke={colors[variant]} strokeWidth={strokeWidth} strokeLinecap="round" />
      <path d="M12 5v14" stroke={colors[variant]} strokeWidth={strokeWidth} strokeLinecap="round" />
    </svg>
  );
}
