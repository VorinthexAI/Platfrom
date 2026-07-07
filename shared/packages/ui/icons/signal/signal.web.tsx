import type { SVGProps } from "react";
export type SignalIconVariant = "default" | "inherit" | "muted" | "accent" | "danger" | "inverse";
export type SignalIconSize = "sm" | "md" | "lg";
export type SignalIconProps = Omit<SVGProps<SVGSVGElement>, "color"> & {
  variant?: SignalIconVariant;
  size?: SignalIconSize;
};
const sizes: Record<SignalIconSize, number> = { sm: 16, md: 20, lg: 24 };
const colors: Record<SignalIconVariant, string> = {
  default: "var(--vui-color-text)",
  inherit: "currentColor",
  muted: "var(--vui-color-muted)",
  accent: "var(--vui-color-accent)",
  danger: "var(--vui-color-danger)",
  inverse: "var(--vui-color-page)",
};
export function SignalIcon({ variant = "inherit", size = "md", strokeWidth = 1.5, ...props }: SignalIconProps) {
  const pixelSize = sizes[size];
  return (
    <svg width={pixelSize} height={pixelSize} viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false" {...props}>
      <rect x="3" y="5" width="18" height="14" rx="2" stroke={colors[variant]} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" />
      <path d="m4 7 8 6 8-6" stroke={colors[variant]} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
