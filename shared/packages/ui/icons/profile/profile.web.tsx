import type { SVGProps } from "react";
export type ProfileIconVariant = "default" | "inherit" | "muted" | "accent" | "danger" | "inverse";
export type ProfileIconSize = "sm" | "md" | "lg";
export type ProfileIconProps = Omit<SVGProps<SVGSVGElement>, "color"> & {
  variant?: ProfileIconVariant;
  size?: ProfileIconSize;
};
const sizes: Record<ProfileIconSize, number> = { sm: 16, md: 20, lg: 24 };
const colors: Record<ProfileIconVariant, string> = {
  default: "var(--vui-color-text)",
  inherit: "currentColor",
  muted: "var(--vui-color-muted)",
  accent: "var(--vui-color-accent)",
  danger: "var(--vui-color-danger)",
  inverse: "var(--vui-color-page)",
};
export function ProfileIcon({ variant = "inherit", size = "md", strokeWidth = 1.4, ...props }: ProfileIconProps) {
  const pixelSize = sizes[size];
  return (
    <svg width={pixelSize} height={pixelSize} viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false" {...props}>
      <path d="M5 12h14" stroke={colors[variant]} strokeWidth={strokeWidth} strokeLinecap="round" />
      <path d="M12 5v14" stroke={colors[variant]} strokeWidth={strokeWidth} strokeLinecap="round" />
    </svg>
  );
}
