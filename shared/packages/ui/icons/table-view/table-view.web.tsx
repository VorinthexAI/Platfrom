import type { SVGProps } from "react";

export type TableViewIconVariant = "default" | "inherit" | "muted" | "accent" | "danger" | "inverse";
export type TableViewIconSize = "sm" | "md" | "lg";
export type TableViewIconProps = Omit<SVGProps<SVGSVGElement>, "color"> & {
  variant?: TableViewIconVariant;
  size?: TableViewIconSize;
};

const sizes: Record<TableViewIconSize, number> = { sm: 16, md: 20, lg: 24 };
const colors: Record<TableViewIconVariant, string> = {
  default: "var(--vui-color-text)",
  inherit: "currentColor",
  muted: "var(--vui-color-muted)",
  accent: "var(--vui-color-accent)",
  danger: "var(--vui-color-danger)",
  inverse: "var(--vui-color-page)",
};

export function TableViewIcon({ variant = "inherit", size = "md", strokeWidth = 1.4, ...props }: TableViewIconProps) {
  const pixelSize = sizes[size];
  const color = colors[variant];
  return (
    <svg width={pixelSize} height={pixelSize} viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false" {...props}>
      <rect x="3.5" y="4" width="17" height="16" rx="2" stroke={color} strokeWidth={strokeWidth} />
      <path d="M3.5 9h17M3.5 14.5h17M10 9v11" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" />
    </svg>
  );
}
