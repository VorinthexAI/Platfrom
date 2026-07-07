import type { SVGProps } from "react";
export type GlobeIconVariant = "default" | "inherit" | "muted" | "accent" | "danger" | "inverse";
export type GlobeIconSize = "sm" | "md" | "lg";
export type GlobeIconProps = Omit<SVGProps<SVGSVGElement>, "color"> & {
  variant?: GlobeIconVariant;
  size?: GlobeIconSize;
};
const sizes: Record<GlobeIconSize, number> = { sm: 16, md: 20, lg: 24 };
const colors: Record<GlobeIconVariant, string> = {
  default: "var(--vui-color-text)",
  inherit: "currentColor",
  muted: "var(--vui-color-muted)",
  accent: "var(--vui-color-accent)",
  danger: "var(--vui-color-danger)",
  inverse: "var(--vui-color-page)",
};
export function GlobeIcon({ variant = "inherit", size = "md", strokeWidth = 1.4, ...props }: GlobeIconProps) {
  const pixelSize = sizes[size];
  const color = colors[variant];
  return (
    <svg width={pixelSize} height={pixelSize} viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false" {...props}>
      <circle cx="12" cy="12" r="8.5" stroke={color} strokeWidth={strokeWidth} />
      <path d="M3.5 12h17" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" />
      <path d="M12 3.5c2.8 2.3 4.3 5.4 4.3 8.5s-1.5 6.2-4.3 8.5c-2.8-2.3-4.3-5.4-4.3-8.5S9.2 5.8 12 3.5Z" stroke={color} strokeWidth={strokeWidth} strokeLinejoin="round" />
    </svg>
  );
}
