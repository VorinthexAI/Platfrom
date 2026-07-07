import type { SVGProps } from "react";
export type UnlockIconVariant = "default" | "inherit" | "muted" | "accent" | "danger" | "inverse";
export type UnlockIconSize = "sm" | "md" | "lg";
export type UnlockIconProps = Omit<SVGProps<SVGSVGElement>, "color"> & {
  variant?: UnlockIconVariant;
  size?: UnlockIconSize;
};
const sizes: Record<UnlockIconSize, number> = { sm: 16, md: 20, lg: 24 };
const colors: Record<UnlockIconVariant, string> = {
  default: "var(--vui-color-text)",
  inherit: "currentColor",
  muted: "var(--vui-color-muted)",
  accent: "var(--vui-color-accent)",
  danger: "var(--vui-color-danger)",
  inverse: "var(--vui-color-page)",
};
export function UnlockIcon({ variant = "inherit", size = "md", strokeWidth = 1.4, ...props }: UnlockIconProps) {
  const pixelSize = sizes[size];
  return (
    <svg width={pixelSize} height={pixelSize} viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false" {...props}>
      <path d="M5 12h14" stroke={colors[variant]} strokeWidth={strokeWidth} strokeLinecap="round" />
      <path d="M12 5v14" stroke={colors[variant]} strokeWidth={strokeWidth} strokeLinecap="round" />
    </svg>
  );
}
