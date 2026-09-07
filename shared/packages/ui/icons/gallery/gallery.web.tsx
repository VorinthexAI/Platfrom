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
      <path d="M6 3h13a2 2 0 0 1 2 2v11" stroke={colors[variant]} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" />
      <rect x="3" y="6" width="16" height="15" rx="2" stroke={colors[variant]} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="8" cy="11" r="1.5" stroke={colors[variant]} strokeWidth={strokeWidth} />
      <path d="m4 18 4-4a1.4 1.4 0 0 1 2 0l2 2 1.5-1.5a1.4 1.4 0 0 1 2 0L19 18" stroke={colors[variant]} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
