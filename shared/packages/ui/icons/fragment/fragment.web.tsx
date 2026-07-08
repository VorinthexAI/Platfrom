import type { SVGProps } from "react";
export type FragmentIconVariant = "default" | "inherit" | "muted" | "accent" | "danger" | "inverse";
export type FragmentIconSize = "sm" | "md" | "lg";
export type FragmentIconProps = Omit<SVGProps<SVGSVGElement>, "color"> & {
  variant?: FragmentIconVariant;
  size?: FragmentIconSize;
};
const sizes: Record<FragmentIconSize, number> = { sm: 16, md: 20, lg: 24 };
const colors: Record<FragmentIconVariant, string> = {
  default: "var(--vui-color-text)",
  inherit: "currentColor",
  muted: "var(--vui-color-muted)",
  accent: "var(--vui-color-accent)",
  danger: "var(--vui-color-danger)",
  inverse: "var(--vui-color-page)",
};
export function FragmentIcon({ variant = "inherit", size = "md", strokeWidth = 1.5, ...props }: FragmentIconProps) {
  const pixelSize = sizes[size];
  return (
    <svg width={pixelSize} height={pixelSize} viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false" {...props}>
      <path d="M12.5 3 18.5 9 14 21 9.5 20 5 8.5Z" stroke={colors[variant]} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" />
      <path d="M12.5 3 12 20.5" stroke={colors[variant]} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" />
      <path d="M5 8.5 12.2 10 18.5 9" stroke={colors[variant]} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
