import type { SVGProps } from "react";
export type FilterIconVariant = "default" | "inherit" | "muted" | "accent" | "danger" | "inverse";
export type FilterIconSize = "sm" | "md" | "lg";
export type FilterIconProps = Omit<SVGProps<SVGSVGElement>, "color"> & {
  variant?: FilterIconVariant;
  size?: FilterIconSize;
};
const sizes: Record<FilterIconSize, number> = { sm: 16, md: 20, lg: 24 };
const colors: Record<FilterIconVariant, string> = {
  default: "var(--vui-color-text)",
  inherit: "currentColor",
  muted: "var(--vui-color-muted)",
  accent: "var(--vui-color-accent)",
  danger: "var(--vui-color-danger)",
  inverse: "var(--vui-color-page)",
};
export function FilterIcon({ variant = "inherit", size = "md", strokeWidth = 1.4, ...props }: FilterIconProps) {
  const pixelSize = sizes[size];
  return (
    <svg width={pixelSize} height={pixelSize} viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false" {...props}>
      <path d="M4 5h16l-6.25 7.1v5.4l-3.5 1.75V12.1L4 5Z" stroke={colors[variant]} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
