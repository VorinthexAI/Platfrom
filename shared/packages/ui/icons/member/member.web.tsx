import type { SVGProps } from "react";
export type MemberIconVariant = "default" | "inherit" | "muted" | "accent" | "danger" | "inverse";
export type MemberIconSize = "sm" | "md" | "lg";
export type MemberIconProps = Omit<SVGProps<SVGSVGElement>, "color"> & {
  variant?: MemberIconVariant;
  size?: MemberIconSize;
};
const sizes: Record<MemberIconSize, number> = { sm: 16, md: 20, lg: 24 };
const colors: Record<MemberIconVariant, string> = {
  default: "var(--vui-color-text)",
  inherit: "currentColor",
  muted: "var(--vui-color-muted)",
  accent: "var(--vui-color-accent)",
  danger: "var(--vui-color-danger)",
  inverse: "var(--vui-color-page)",
};
export function MemberIcon({ variant = "inherit", size = "md", strokeWidth = 1.4, ...props }: MemberIconProps) {
  const pixelSize = sizes[size];
  return (
    <svg width={pixelSize} height={pixelSize} viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false" {...props}>
      <path d="M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z" stroke={colors[variant]} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" />
      <path d="M4 21a8 8 0 0 1 16 0" stroke={colors[variant]} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
