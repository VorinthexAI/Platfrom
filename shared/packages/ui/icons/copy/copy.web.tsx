import type { SVGProps } from "react";
export type CopyIconVariant = "default" | "inherit" | "muted" | "accent" | "danger" | "inverse";
export type CopyIconSize = "sm" | "md" | "lg";
export type CopyIconProps = Omit<SVGProps<SVGSVGElement>, "color"> & {
  variant?: CopyIconVariant;
  size?: CopyIconSize;
};
const sizes: Record<CopyIconSize, number> = { sm: 16, md: 20, lg: 24 };
const colors: Record<CopyIconVariant, string> = {
  default: "var(--vui-color-text)",
  inherit: "currentColor",
  muted: "var(--vui-color-muted)",
  accent: "var(--vui-color-accent)",
  danger: "var(--vui-color-danger)",
  inverse: "var(--vui-color-page)",
};
export function CopyIcon({ variant = "inherit", size = "md", strokeWidth = 1.4, ...props }: CopyIconProps) {
  const pixelSize = sizes[size];
  return (
    <svg width={pixelSize} height={pixelSize} viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false" {...props}>
      <path d="M9 8h9a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2v-9a2 2 0 0 1 2-2Z" stroke={colors[variant]} strokeWidth={strokeWidth} strokeLinejoin="round" />
      <path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h2" stroke={colors[variant]} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
