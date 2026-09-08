import type { SVGProps } from "react";

export type SignOutIconVariant = "default" | "inherit" | "muted" | "accent" | "danger" | "inverse";
export type SignOutIconSize = "sm" | "md" | "lg";
export type SignOutIconProps = Omit<SVGProps<SVGSVGElement>, "color"> & { variant?: SignOutIconVariant; size?: SignOutIconSize };

const sizes: Record<SignOutIconSize, number> = { sm: 16, md: 20, lg: 24 };
const colors: Record<SignOutIconVariant, string> = {
  default: "var(--vui-color-text)",
  inherit: "currentColor",
  muted: "var(--vui-color-muted)",
  accent: "var(--vui-color-accent)",
  danger: "var(--vui-color-danger)",
  inverse: "var(--vui-color-page)",
};

export function SignOutIcon({ variant = "inherit", size = "md", strokeWidth = 1.4, ...props }: SignOutIconProps) {
  const pixelSize = sizes[size];
  const color = colors[variant];
  return (
    <svg width={pixelSize} height={pixelSize} viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false" {...props}>
      <path d="M13.5 4H6v16h7.5M10 12h11M17.5 8.5 21 12l-3.5 3.5" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" />
      <path d="M6 4 3 6v12l3 2" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
