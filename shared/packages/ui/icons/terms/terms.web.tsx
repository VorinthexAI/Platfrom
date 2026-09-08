import type { SVGProps } from "react";

export type TermsIconVariant = "default" | "inherit" | "muted" | "accent" | "danger" | "inverse";
export type TermsIconSize = "sm" | "md" | "lg";
export type TermsIconProps = Omit<SVGProps<SVGSVGElement>, "color"> & { variant?: TermsIconVariant; size?: TermsIconSize };

const sizes: Record<TermsIconSize, number> = { sm: 16, md: 20, lg: 24 };
const colors: Record<TermsIconVariant, string> = {
  default: "var(--vui-color-text)",
  inherit: "currentColor",
  muted: "var(--vui-color-muted)",
  accent: "var(--vui-color-accent)",
  danger: "var(--vui-color-danger)",
  inverse: "var(--vui-color-page)",
};

export function TermsIcon({ variant = "inherit", size = "md", strokeWidth = 1.4, ...props }: TermsIconProps) {
  const pixelSize = sizes[size];
  const color = colors[variant];
  return (
    <svg width={pixelSize} height={pixelSize} viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false" {...props}>
      <path d="M6 3.5h8l4 4V20.5H6zM14 3.5v4h4" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" />
      <path d="m9 12 1.2 1.2 2-2.2M9 16.5h6" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
