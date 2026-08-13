import type { SVGProps } from "react";
export type DownloadIconVariant = "default" | "inherit" | "muted" | "accent" | "danger" | "inverse";
export type DownloadIconSize = "sm" | "md" | "lg";
export type DownloadIconProps = Omit<SVGProps<SVGSVGElement>, "color"> & {
  variant?: DownloadIconVariant;
  size?: DownloadIconSize;
};
const sizes: Record<DownloadIconSize, number> = { sm: 16, md: 20, lg: 24 };
const colors: Record<DownloadIconVariant, string> = {
  default: "var(--vui-color-text)",
  inherit: "currentColor",
  muted: "var(--vui-color-muted)",
  accent: "var(--vui-color-accent)",
  danger: "var(--vui-color-danger)",
  inverse: "var(--vui-color-page)",
};
export function DownloadIcon({ variant = "inherit", size = "md", strokeWidth = 1.4, ...props }: DownloadIconProps) {
  const pixelSize = sizes[size];
  return (
    <svg width={pixelSize} height={pixelSize} viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false" {...props}>
      <path d="M12 3v12m0 0 4-4m-4 4-4-4" stroke={colors[variant]} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" />
      <path d="M5 16v4h14v-4" stroke={colors[variant]} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
