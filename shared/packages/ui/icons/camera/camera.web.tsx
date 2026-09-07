import type { SVGProps } from "react";
export type CameraIconVariant = "default" | "inherit" | "muted" | "accent" | "danger" | "inverse";
export type CameraIconSize = "sm" | "md" | "lg";
export type CameraIconProps = Omit<SVGProps<SVGSVGElement>, "color"> & {
  variant?: CameraIconVariant;
  size?: CameraIconSize;
};
const sizes: Record<CameraIconSize, number> = { sm: 16, md: 20, lg: 24 };
const colors: Record<CameraIconVariant, string> = {
  default: "var(--vui-color-text)",
  inherit: "currentColor",
  muted: "var(--vui-color-muted)",
  accent: "var(--vui-color-accent)",
  danger: "var(--vui-color-danger)",
  inverse: "var(--vui-color-page)",
};
export function CameraIcon({ variant = "inherit", size = "md", strokeWidth = 1.4, ...props }: CameraIconProps) {
  const pixelSize = sizes[size];
  return (
    <svg width={pixelSize} height={pixelSize} viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false" {...props}>
      <path d="M14.5 5 16 7h2.5A2.5 2.5 0 0 1 21 9.5v7a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 16.5v-7A2.5 2.5 0 0 1 5.5 7H8l1.5-2h5Z" stroke={colors[variant]} strokeWidth={strokeWidth} strokeLinejoin="round" />
      <circle cx="12" cy="13" r="3.25" stroke={colors[variant]} strokeWidth={strokeWidth} />
    </svg>
  );
}
