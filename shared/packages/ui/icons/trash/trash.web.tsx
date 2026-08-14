import type { SVGProps } from "react";
export type TrashIconVariant = "default" | "inherit" | "muted" | "accent" | "danger" | "inverse";
export type TrashIconSize = "sm" | "md" | "lg";
export type TrashIconProps = Omit<SVGProps<SVGSVGElement>, "color"> & {
  variant?: TrashIconVariant;
  size?: TrashIconSize;
};
const sizes: Record<TrashIconSize, number> = { sm: 16, md: 20, lg: 24 };
const colors: Record<TrashIconVariant, string> = {
  default: "var(--vui-color-text)",
  inherit: "currentColor",
  muted: "var(--vui-color-muted)",
  accent: "var(--vui-color-accent)",
  danger: "var(--vui-color-danger)",
  inverse: "var(--vui-color-page)",
};
export function TrashIcon({ variant = "inherit", size = "md", strokeWidth = 1.4, ...props }: TrashIconProps) {
  const pixelSize = sizes[size];
  return (
    <svg width={pixelSize} height={pixelSize} viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false" {...props}>
      <path d="M4 7h16M9 7V4h6v3M6.5 7l1 13h9l1-13M10 11v5M14 11v5" stroke={colors[variant]} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
