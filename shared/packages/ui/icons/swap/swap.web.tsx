import type { SVGProps } from "react";

export type SwapIconVariant = "default" | "inherit" | "muted" | "accent" | "danger" | "inverse";
export type SwapIconSize = "sm" | "md" | "lg";
export type SwapIconProps = Omit<SVGProps<SVGSVGElement>, "color"> & {
  variant?: SwapIconVariant;
  size?: SwapIconSize;
};

const sizes: Record<SwapIconSize, number> = { sm: 16, md: 20, lg: 24 };
const colors: Record<SwapIconVariant, string> = {
  default: "var(--vui-color-text)",
  inherit: "currentColor",
  muted: "var(--vui-color-muted)",
  accent: "var(--vui-color-accent)",
  danger: "var(--vui-color-danger)",
  inverse: "var(--vui-color-page)",
};

export function SwapIcon({ variant = "inherit", size = "md", strokeWidth = 1.4, ...props }: SwapIconProps) {
  const pixelSize = sizes[size];
  const color = colors[variant];
  return (
    <svg aria-hidden="true" fill="none" focusable="false" height={pixelSize} viewBox="0 0 24 24" width={pixelSize} {...props}>
      <path d="M5 7h14m-4-4 4 4-4 4" stroke={color} strokeLinecap="round" strokeLinejoin="round" strokeWidth={strokeWidth} />
      <path d="M19 17H5m4-4-4 4 4 4" stroke={color} strokeLinecap="round" strokeLinejoin="round" strokeWidth={strokeWidth} />
    </svg>
  );
}
