import type { SVGProps } from "react";
export type ChartIconVariant = "default" | "inherit" | "muted" | "accent" | "danger" | "inverse";
export type ChartIconSize = "sm" | "md" | "lg";
export type ChartIconProps = Omit<SVGProps<SVGSVGElement>, "color"> & { variant?: ChartIconVariant; size?: ChartIconSize };
const sizes: Record<ChartIconSize, number> = { sm: 16, md: 20, lg: 24 };
const colors: Record<ChartIconVariant, string> = { default: "var(--vui-color-text)", inherit: "currentColor", muted: "var(--vui-color-muted)", accent: "var(--vui-color-accent)", danger: "var(--vui-color-danger)", inverse: "var(--vui-color-page)" };
export function ChartIcon({ variant = "inherit", size = "md", strokeWidth = 1.4, ...props }: ChartIconProps) {
  const pixelSize = sizes[size];
  const color = colors[variant];
  return (
    <svg width={pixelSize} height={pixelSize} viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false" {...props}>
      <path d="M5 19.5h14" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" />
      <path d="M7 16.5v-4M12 16.5V8M17 16.5v-7" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" />
    </svg>
  );
}
