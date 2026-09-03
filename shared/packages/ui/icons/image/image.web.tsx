import type { SVGProps } from "react";
export type ImageIconVariant = "default" | "inherit" | "muted" | "accent" | "danger" | "inverse";
export type ImageIconSize = "sm" | "md" | "lg";
export type ImageIconProps = Omit<SVGProps<SVGSVGElement>, "color"> & {
  variant?: ImageIconVariant;
  size?: ImageIconSize;
};
const sizes: Record<ImageIconSize, number> = { sm: 16, md: 20, lg: 24 };
const colors: Record<ImageIconVariant, string> = {
  default: "var(--vui-color-text)",
  inherit: "currentColor",
  muted: "var(--vui-color-muted)",
  accent: "var(--vui-color-accent)",
  danger: "var(--vui-color-danger)",
  inverse: "var(--vui-color-page)",
};
export function ImageIcon({ variant = "inherit", size = "md", strokeWidth = 1.4, ...props }: ImageIconProps) {
  const pixelSize = sizes[size];
  return (
    <svg width={pixelSize} height={pixelSize} viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false" {...props}>
      <rect x="3" y="4" width="18" height="16" rx="2" stroke={colors[variant]} strokeWidth={strokeWidth} />
      <circle cx="8.5" cy="9" r="1.5" stroke={colors[variant]} strokeWidth={strokeWidth} />
      <path d="m4 17 4.5-4.5 3.5 3.5 2-2 6 6" stroke={colors[variant]} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
