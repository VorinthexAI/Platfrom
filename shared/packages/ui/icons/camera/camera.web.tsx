import type { SVGProps } from "react";
export type CameraIconVariant = "default" | "muted" | "accent" | "danger" | "inverse";
export type CameraIconSize = "sm" | "md" | "lg";
export type CameraIconProps = Omit<SVGProps<SVGSVGElement>, "color"> & {
  variant?: CameraIconVariant;
  size?: CameraIconSize;
};
const sizes: Record<CameraIconSize, number> = { sm: 16, md: 20, lg: 24 };
const colors: Record<CameraIconVariant, string> = {
  default: "var(--vui-color-text)",
  muted: "var(--vui-color-muted)",
  accent: "var(--vui-color-accent)",
  danger: "var(--vui-color-danger)",
  inverse: "var(--vui-color-page)",
};
export function CameraIcon({ variant = "default", size = "md", strokeWidth = 1.4, ...props }: CameraIconProps) {
  const pixelSize = sizes[size];
  return (
    <svg width={pixelSize} height={pixelSize} viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false" {...props}>
      <path d="M5 12h14" stroke={colors[variant]} strokeWidth={strokeWidth} strokeLinecap="round" />
      <path d="M12 5v14" stroke={colors[variant]} strokeWidth={strokeWidth} strokeLinecap="round" />
    </svg>
  );
}
