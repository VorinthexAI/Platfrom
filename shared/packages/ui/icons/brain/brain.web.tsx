import type { SVGProps } from "react";
export type BrainIconVariant = "default" | "inherit" | "muted" | "accent" | "danger" | "inverse";
export type BrainIconSize = "sm" | "md" | "lg";
export type BrainIconProps = Omit<SVGProps<SVGSVGElement>, "color"> & {
  variant?: BrainIconVariant;
  size?: BrainIconSize;
};
const sizes: Record<BrainIconSize, number> = { sm: 16, md: 20, lg: 24 };
const colors: Record<BrainIconVariant, string> = {
  default: "var(--vui-color-text)",
  inherit: "currentColor",
  muted: "var(--vui-color-muted)",
  accent: "var(--vui-color-accent)",
  danger: "var(--vui-color-danger)",
  inverse: "var(--vui-color-page)",
};
export function BrainIcon({ variant = "inherit", size = "md", strokeWidth = 1.5, ...props }: BrainIconProps) {
  const pixelSize = sizes[size];
  return (
    <svg width={pixelSize} height={pixelSize} viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false" {...props}>
      <path d="M12 4a3.5 3.5 0 0 0-3.5 3.5c-2 .3-3.5 1.8-3.5 3.9 0 1.3.6 2.4 1.5 3.1-.3.5-.5 1.1-.5 1.8A3.7 3.7 0 0 0 9.7 20c.9 0 1.7-.3 2.3-.9.6.6 1.4.9 2.3.9a3.7 3.7 0 0 0 3.7-3.7c0-.7-.2-1.3-.5-1.8.9-.7 1.5-1.8 1.5-3.1 0-2.1-1.5-3.6-3.5-3.9A3.5 3.5 0 0 0 12 4Z" stroke={colors[variant]} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" />
      <path d="M12 4v16" stroke={colors[variant]} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
