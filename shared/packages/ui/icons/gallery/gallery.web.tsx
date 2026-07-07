import type { SVGProps } from "react";
export type GalleryIconVariant = "default" | "inherit" | "muted" | "accent" | "danger" | "inverse";
export type GalleryIconSize = "sm" | "md" | "lg";
export type GalleryIconProps = Omit<SVGProps<SVGSVGElement>, "color"> & {
  variant?: GalleryIconVariant;
  size?: GalleryIconSize;
};
const sizes: Record<GalleryIconSize, number> = { sm: 16, md: 20, lg: 24 };
const colors: Record<GalleryIconVariant, string> = {
  default: "var(--vui-color-text)",
  inherit: "currentColor",
  muted: "var(--vui-color-muted)",
  accent: "var(--vui-color-accent)",
  danger: "var(--vui-color-danger)",
  inverse: "var(--vui-color-page)",
};
export function GalleryIcon({ variant = "inherit", size = "md", strokeWidth = 1.5, ...props }: GalleryIconProps) {
  const pixelSize = sizes[size];
  return (
    <svg width={pixelSize} height={pixelSize} viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false" {...props}>
      <rect x="3" y="4" width="18" height="16" rx="2" stroke={colors[variant]} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="9" cy="10" r="1.6" stroke={colors[variant]} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" />
      <path d="m3 17 5.2-5.2a1.5 1.5 0 0 1 2.1 0L16 17.5" stroke={colors[variant]} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" />
      <path d="m14 15 2.3-2.3a1.5 1.5 0 0 1 2.1 0L21 15.3" stroke={colors[variant]} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
