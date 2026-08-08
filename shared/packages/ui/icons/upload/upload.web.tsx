import type { SVGProps } from "react";
export type UploadIconVariant = "default" | "inherit" | "muted" | "accent" | "danger" | "inverse";
export type UploadIconSize = "sm" | "md" | "lg";
export type UploadIconProps = Omit<SVGProps<SVGSVGElement>, "color"> & {
  variant?: UploadIconVariant;
  size?: UploadIconSize;
};
const sizes: Record<UploadIconSize, number> = { sm: 16, md: 20, lg: 24 };
const colors: Record<UploadIconVariant, string> = {
  default: "var(--vui-color-text)",
  inherit: "currentColor",
  muted: "var(--vui-color-muted)",
  accent: "var(--vui-color-accent)",
  danger: "var(--vui-color-danger)",
  inverse: "var(--vui-color-page)",
};
export function UploadIcon({ variant = "inherit", size = "md", strokeWidth = 1.4, ...props }: UploadIconProps) {
  const pixelSize = sizes[size];
  return (
    <svg width={pixelSize} height={pixelSize} viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false" {...props}>
      <path d="m7 9 5-5 5 5M12 4v12" stroke={colors[variant]} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" />
      <path d="M5 15v4h14v-4" stroke={colors[variant]} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
