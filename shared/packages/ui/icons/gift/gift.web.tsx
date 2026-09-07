import type { SVGProps } from "react";

export type GiftIconVariant = "default" | "inherit" | "muted" | "accent" | "danger" | "inverse";
export type GiftIconSize = "sm" | "md" | "lg" | "xl";
export type GiftIconProps = Omit<SVGProps<SVGSVGElement>, "color"> & { variant?: GiftIconVariant; size?: GiftIconSize };

const sizes: Record<GiftIconSize, number> = { sm: 16, md: 20, lg: 24, xl: 56 };
const colors: Record<GiftIconVariant, string> = {
  default: "var(--vui-color-text)",
  inherit: "currentColor",
  muted: "var(--vui-color-muted)",
  accent: "var(--vui-color-accent)",
  danger: "var(--vui-color-danger)",
  inverse: "var(--vui-color-page)",
};

export function GiftIcon({ variant = "inherit", size = "md", strokeWidth = 1.4, ...props }: GiftIconProps) {
  const pixelSize = sizes[size];
  return <svg aria-hidden="true" fill="none" focusable="false" height={pixelSize} viewBox="0 0 24 24" width={pixelSize} {...props}>
    <path d="M4 10h16v10H4V10Zm-1-4h18v4H3V6Zm9 0v14M12 6H8.5A2.5 2.5 0 1 1 11 3.5L12 6Zm0 0h3.5A2.5 2.5 0 1 0 13 3.5L12 6Z" stroke={colors[variant]} strokeLinecap="round" strokeLinejoin="round" strokeWidth={strokeWidth} />
  </svg>;
}
