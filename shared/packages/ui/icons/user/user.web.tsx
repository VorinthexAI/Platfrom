import type { SVGProps } from "react";
export type UserIconVariant = "default" | "muted" | "accent" | "danger" | "inverse";
export type UserIconSize = "sm" | "md" | "lg";
export type UserIconProps = Omit<SVGProps<SVGSVGElement>, "color"> & {
  variant?: UserIconVariant;
  size?: UserIconSize;
};
const sizes: Record<UserIconSize, number> = { sm: 16, md: 20, lg: 24 };
const colors: Record<UserIconVariant, string> = {
  default: "var(--vui-color-text)",
  muted: "var(--vui-color-muted)",
  accent: "var(--vui-color-accent)",
  danger: "var(--vui-color-danger)",
  inverse: "var(--vui-color-page)",
};
export function UserIcon({ variant = "default", size = "md", strokeWidth = 1.4, ...props }: UserIconProps) {
  const pixelSize = sizes[size];
  return (
    <svg width={pixelSize} height={pixelSize} viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false" {...props}>
      <path d="M5 12h14" stroke={colors[variant]} strokeWidth={strokeWidth} strokeLinecap="round" />
      <path d="M12 5v14" stroke={colors[variant]} strokeWidth={strokeWidth} strokeLinecap="round" />
    </svg>
  );
}
