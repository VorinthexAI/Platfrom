import type { SVGProps } from "react";
export type BookmarkIconVariant = "default" | "inherit" | "muted" | "accent" | "danger" | "inverse";
export type BookmarkIconSize = "sm" | "md" | "lg";
export type BookmarkIconProps = Omit<SVGProps<SVGSVGElement>, "color"> & {
  variant?: BookmarkIconVariant;
  size?: BookmarkIconSize;
};
const sizes: Record<BookmarkIconSize, number> = { sm: 16, md: 20, lg: 24 };
const colors: Record<BookmarkIconVariant, string> = {
  default: "var(--vui-color-text)",
  inherit: "currentColor",
  muted: "var(--vui-color-muted)",
  accent: "var(--vui-color-accent)",
  danger: "var(--vui-color-danger)",
  inverse: "var(--vui-color-page)",
};
export function BookmarkIcon({ variant = "inherit", size = "md", strokeWidth = 1.4, ...props }: BookmarkIconProps) {
  const pixelSize = sizes[size];
  return (
    <svg width={pixelSize} height={pixelSize} viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false" {...props}>
      <path d="M5 12h14" stroke={colors[variant]} strokeWidth={strokeWidth} strokeLinecap="round" />
      <path d="M12 5v14" stroke={colors[variant]} strokeWidth={strokeWidth} strokeLinecap="round" />
    </svg>
  );
}
