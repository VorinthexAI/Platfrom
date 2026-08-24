import type { SVGProps } from "react";

export type GlobeViewIconVariant = "default" | "inherit" | "muted" | "accent" | "danger" | "inverse";
export type GlobeViewIconSize = "sm" | "md" | "lg";
export type GlobeViewIconProps = Omit<SVGProps<SVGSVGElement>, "color"> & {
  variant?: GlobeViewIconVariant;
  size?: GlobeViewIconSize;
};

const sizes: Record<GlobeViewIconSize, number> = { sm: 16, md: 20, lg: 24 };
const colors: Record<GlobeViewIconVariant, string> = {
  default: "var(--vui-color-text)",
  inherit: "currentColor",
  muted: "var(--vui-color-muted)",
  accent: "var(--vui-color-accent)",
  danger: "var(--vui-color-danger)",
  inverse: "var(--vui-color-page)",
};

export function GlobeViewIcon({ variant = "inherit", size = "md", strokeWidth = 1.4, ...props }: GlobeViewIconProps) {
  const pixelSize = sizes[size];
  const color = colors[variant];
  return (
    <svg width={pixelSize} height={pixelSize} viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false" {...props}>
      <circle cx="12" cy="12" r="8.5" stroke={color} strokeWidth={strokeWidth} />
      <path d="M4.2 9h15.6M4.2 15h15.6M12 3.5c2.2 2.3 3.4 5.2 3.4 8.5S14.2 18.2 12 20.5C9.8 18.2 8.6 15.3 8.6 12S9.8 5.8 12 3.5Z" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
