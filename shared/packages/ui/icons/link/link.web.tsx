import type { SVGProps } from "react";
export type LinkIconVariant = "default" | "inherit" | "muted" | "accent" | "danger" | "inverse";
export type LinkIconSize = "sm" | "md" | "lg";
export type LinkIconProps = Omit<SVGProps<SVGSVGElement>, "color"> & {
  variant?: LinkIconVariant;
  size?: LinkIconSize;
};
const sizes: Record<LinkIconSize, number> = { sm: 16, md: 20, lg: 24 };
const colors: Record<LinkIconVariant, string> = {
  default: "var(--vui-color-text)",
  inherit: "currentColor",
  muted: "var(--vui-color-muted)",
  accent: "var(--vui-color-accent)",
  danger: "var(--vui-color-danger)",
  inverse: "var(--vui-color-page)",
};
export function LinkIcon({ variant = "inherit", size = "md", strokeWidth = 1.4, ...props }: LinkIconProps) {
  const pixelSize = sizes[size];
  const color = colors[variant];
  return (
    <svg width={pixelSize} height={pixelSize} viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false" {...props}>
      <path d="M9.5 14.5 8 16a3.2 3.2 0 0 1-4.5-4.5l2.2-2.2a3.2 3.2 0 0 1 4.5 0" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" />
      <path d="M14.5 9.5 16 8a3.2 3.2 0 0 1 4.5 4.5l-2.2 2.2a3.2 3.2 0 0 1-4.5 0" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" />
      <path d="M9.2 14.8 14.8 9.2" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" />
    </svg>
  );
}
