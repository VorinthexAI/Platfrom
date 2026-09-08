import type { SVGProps } from "react";

export type PrivacyIconVariant = "default" | "inherit" | "muted" | "accent" | "danger" | "inverse";
export type PrivacyIconSize = "sm" | "md" | "lg";
export type PrivacyIconProps = Omit<SVGProps<SVGSVGElement>, "color"> & { variant?: PrivacyIconVariant; size?: PrivacyIconSize };

const sizes: Record<PrivacyIconSize, number> = { sm: 16, md: 20, lg: 24 };
const colors: Record<PrivacyIconVariant, string> = {
  default: "var(--vui-color-text)",
  inherit: "currentColor",
  muted: "var(--vui-color-muted)",
  accent: "var(--vui-color-accent)",
  danger: "var(--vui-color-danger)",
  inverse: "var(--vui-color-page)",
};

export function PrivacyIcon({ variant = "inherit", size = "md", strokeWidth = 1.4, ...props }: PrivacyIconProps) {
  const pixelSize = sizes[size];
  const color = colors[variant];
  return (
    <svg width={pixelSize} height={pixelSize} viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false" {...props}>
      <path d="M12 3 5 6v5c0 4.6 2.8 8.2 7 10 4.2-1.8 7-5.4 7-10V6l-7-3Z" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="12" cy="10.5" r="2" stroke={color} strokeWidth={strokeWidth} />
      <path d="M12 12.5V16" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" />
    </svg>
  );
}
