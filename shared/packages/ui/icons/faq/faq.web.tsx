import type { SVGProps } from "react";

export type FaqIconVariant = "default" | "inherit" | "muted" | "accent" | "danger" | "inverse";
export type FaqIconSize = "sm" | "md" | "lg";
export type FaqIconProps = Omit<SVGProps<SVGSVGElement>, "color"> & { variant?: FaqIconVariant; size?: FaqIconSize };

const sizes: Record<FaqIconSize, number> = { sm: 16, md: 20, lg: 24 };
const colors: Record<FaqIconVariant, string> = {
  default: "var(--vui-color-text)",
  inherit: "currentColor",
  muted: "var(--vui-color-muted)",
  accent: "var(--vui-color-accent)",
  danger: "var(--vui-color-danger)",
  inverse: "var(--vui-color-page)",
};

export function FaqIcon({ variant = "inherit", size = "md", strokeWidth = 1.4, ...props }: FaqIconProps) {
  const pixelSize = sizes[size];
  const color = colors[variant];
  return (
    <svg width={pixelSize} height={pixelSize} viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false" {...props}>
      <path d="M5 4h14v16H5z" stroke={color} strokeWidth={strokeWidth} strokeLinejoin="round" />
      <path d="M8.5 4v16M11.5 8.5a2 2 0 1 1 2.7 1.88c-.58.25-.95.66-.95 1.37" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="13.25" cy="15" r="0.7" fill={color} />
    </svg>
  );
}
