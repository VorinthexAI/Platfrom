import type { SVGProps } from "react";
export type FolderIconVariant = "default" | "inherit" | "muted" | "accent" | "danger" | "inverse";
export type FolderIconSize = "sm" | "md" | "lg";
export type FolderIconProps = Omit<SVGProps<SVGSVGElement>, "color"> & {
  variant?: FolderIconVariant;
  size?: FolderIconSize;
};
const sizes: Record<FolderIconSize, number> = { sm: 16, md: 20, lg: 24 };
const colors: Record<FolderIconVariant, string> = {
  default: "var(--vui-color-text)",
  inherit: "currentColor",
  muted: "var(--vui-color-muted)",
  accent: "var(--vui-color-accent)",
  danger: "var(--vui-color-danger)",
  inverse: "var(--vui-color-page)",
};
export function FolderIcon({ variant = "inherit", size = "md", strokeWidth = 1.4, ...props }: FolderIconProps) {
  const pixelSize = sizes[size];
  return (
    <svg width={pixelSize} height={pixelSize} viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false" {...props}>
      <path d="M3 7.5A2.5 2.5 0 0 1 5.5 5h4l2 2H18.5A2.5 2.5 0 0 1 21 9.5v7A2.5 2.5 0 0 1 18.5 19h-13A2.5 2.5 0 0 1 3 16.5v-9Z" stroke={colors[variant]} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
