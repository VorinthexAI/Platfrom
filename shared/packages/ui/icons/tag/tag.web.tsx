import type { SVGProps } from "react";
export type TagIconVariant = "default" | "inherit" | "muted" | "accent" | "danger" | "inverse";
export type TagIconSize = "sm" | "md" | "lg";
export type TagIconProps = Omit<SVGProps<SVGSVGElement>, "color"> & { variant?: TagIconVariant; size?: TagIconSize };
const sizes: Record<TagIconSize, number> = { sm: 16, md: 20, lg: 24 };
const colors: Record<TagIconVariant, string> = { default: "var(--vui-color-text)", inherit: "currentColor", muted: "var(--vui-color-muted)", accent: "var(--vui-color-accent)", danger: "var(--vui-color-danger)", inverse: "var(--vui-color-page)" };
export function TagIcon({ variant = "inherit", size = "md", strokeWidth = 1.4, ...props }: TagIconProps) {
  const pixelSize = sizes[size];
  const color = colors[variant];
  return (
    <svg width={pixelSize} height={pixelSize} viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false" {...props}>
      <path d="M4 5.5A1.5 1.5 0 0 1 5.5 4H11l9 9-6.5 6.5-9-9V5.5Z" stroke={color} strokeWidth={strokeWidth} strokeLinejoin="round" />
      <path d="M8.2 8.2h.01" stroke={color} strokeWidth={2.2} strokeLinecap="round" />
    </svg>
  );
}
