import type { SVGProps } from "react";
export type MenuIconVariant = "default" | "inherit" | "muted" | "accent" | "danger" | "inverse";
export type MenuIconSize = "sm" | "md" | "lg";
export type MenuIconProps = Omit<SVGProps<SVGSVGElement>, "color"> & {
  variant?: MenuIconVariant;
  size?: MenuIconSize;
};
const sizes: Record<MenuIconSize, number> = { sm: 16, md: 20, lg: 24 };
const colors: Record<MenuIconVariant, string> = {
  default: "var(--vui-color-text)",
  inherit: "currentColor",
  muted: "var(--vui-color-muted)",
  accent: "var(--vui-color-accent)",
  danger: "var(--vui-color-danger)",
  inverse: "var(--vui-color-page)",
};
export function MenuIcon({ variant = "inherit", size = "md", strokeWidth = 1.4, ...props }: MenuIconProps) {
  const pixelSize = sizes[size];
  return (
    <svg width={pixelSize} height={pixelSize} viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false" {...props}>
      <path d="M4 7h16" stroke={colors[variant]} strokeWidth={strokeWidth} strokeLinecap="round" />
      <path d="M4 12h16" stroke={colors[variant]} strokeWidth={strokeWidth} strokeLinecap="round" />
      <path d="M4 17h16" stroke={colors[variant]} strokeWidth={strokeWidth} strokeLinecap="round" />
    </svg>
  );
}
