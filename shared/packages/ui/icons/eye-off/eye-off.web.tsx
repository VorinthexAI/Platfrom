import type { SVGProps } from "react";
export type EyeOffIconVariant = "default" | "inherit" | "muted" | "accent" | "danger" | "inverse";
export type EyeOffIconSize = "sm" | "md" | "lg";
export type EyeOffIconProps = Omit<SVGProps<SVGSVGElement>, "color"> & {
  variant?: EyeOffIconVariant;
  size?: EyeOffIconSize;
};
const sizes: Record<EyeOffIconSize, number> = { sm: 16, md: 20, lg: 24 };
const colors: Record<EyeOffIconVariant, string> = {
  default: "var(--vui-color-text)",
  inherit: "currentColor",
  muted: "var(--vui-color-muted)",
  accent: "var(--vui-color-accent)",
  danger: "var(--vui-color-danger)",
  inverse: "var(--vui-color-page)",
};
export function EyeOffIcon({ variant = "inherit", size = "md", strokeWidth = 1.4, ...props }: EyeOffIconProps) {
  const pixelSize = sizes[size];
  return (
    <svg width={pixelSize} height={pixelSize} viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false" {...props}>
      <path d="M5 12h14" stroke={colors[variant]} strokeWidth={strokeWidth} strokeLinecap="round" />
      <path d="M12 5v14" stroke={colors[variant]} strokeWidth={strokeWidth} strokeLinecap="round" />
    </svg>
  );
}
