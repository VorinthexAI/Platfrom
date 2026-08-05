import type { SVGProps } from "react";

export type ShieldIconVariant = "default" | "inherit" | "muted" | "accent" | "danger" | "inverse";
export type ShieldIconSize = "sm" | "md" | "lg";
export type ShieldIconProps = Omit<SVGProps<SVGSVGElement>, "color"> & {
  variant?: ShieldIconVariant;
  size?: ShieldIconSize;
};

const sizes: Record<ShieldIconSize, number> = { sm: 16, md: 20, lg: 24 };
const colors: Record<ShieldIconVariant, string> = {
  default: "var(--vui-color-text)",
  inherit: "currentColor",
  muted: "var(--vui-color-muted)",
  accent: "var(--vui-color-accent)",
  danger: "var(--vui-color-danger)",
  inverse: "var(--vui-color-page)",
};

export function ShieldIcon({ variant = "inherit", size = "md", strokeWidth = 1.4, ...props }: ShieldIconProps) {
  const pixelSize = sizes[size];
  return (
    <svg width={pixelSize} height={pixelSize} viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false" {...props}>
      <path d="M12 3 19 6v5.2c0 4.6-2.8 7.7-7 9.8-4.2-2.1-7-5.2-7-9.8V6l7-3Z" stroke={colors[variant]} strokeWidth={strokeWidth} strokeLinejoin="round" />
      <path d="M12 7v9" stroke={colors[variant]} strokeWidth={strokeWidth} strokeLinecap="round" />
    </svg>
  );
}
