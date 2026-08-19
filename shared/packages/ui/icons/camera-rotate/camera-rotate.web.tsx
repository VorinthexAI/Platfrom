import type { SVGProps } from "react";

export type CameraRotateIconVariant = "default" | "inherit" | "muted" | "accent" | "danger" | "inverse";
export type CameraRotateIconSize = "sm" | "md" | "lg";
export type CameraRotateIconProps = Omit<SVGProps<SVGSVGElement>, "color"> & {
  variant?: CameraRotateIconVariant;
  size?: CameraRotateIconSize;
};

const sizes: Record<CameraRotateIconSize, number> = { sm: 16, md: 20, lg: 24 };
const colors: Record<CameraRotateIconVariant, string> = {
  default: "var(--vui-color-text)",
  inherit: "currentColor",
  muted: "var(--vui-color-muted)",
  accent: "var(--vui-color-accent)",
  danger: "var(--vui-color-danger)",
  inverse: "var(--vui-color-page)",
};

export function CameraRotateIcon({ variant = "inherit", size = "md", strokeWidth = 1.4, ...props }: CameraRotateIconProps) {
  const pixelSize = sizes[size];
  const color = colors[variant];
  return (
    <svg width={pixelSize} height={pixelSize} viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false" {...props}>
      <path d="M4 8a8.5 8.5 0 0 1 14.4-2.1L20 7.5" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" />
      <path d="M20 4v3.5h-3.5" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" />
      <path d="M20 16a8.5 8.5 0 0 1-14.4 2.1L4 16.5" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" />
      <path d="M4 20v-3.5h3.5" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" />
      <path d="m9.5 9 1-1.5h3L14.5 9H16a1.5 1.5 0 0 1 1.5 1.5v3A1.5 1.5 0 0 1 16 15H8a1.5 1.5 0 0 1-1.5-1.5v-3A1.5 1.5 0 0 1 8 9h1.5Z" stroke={color} strokeWidth={strokeWidth} strokeLinejoin="round" />
      <path d="M13.5 12a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0Z" stroke={color} strokeWidth={strokeWidth} />
    </svg>
  );
}
