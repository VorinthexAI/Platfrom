import type { SVGProps } from "react";
export type FileIconVariant = "default" | "inherit" | "muted" | "accent" | "danger" | "inverse";
export type FileIconSize = "sm" | "md" | "lg";
export type FileIconProps = Omit<SVGProps<SVGSVGElement>, "color"> & {
  variant?: FileIconVariant;
  size?: FileIconSize;
};
const sizes: Record<FileIconSize, number> = { sm: 16, md: 20, lg: 24 };
const colors: Record<FileIconVariant, string> = {
  default: "var(--vui-color-text)",
  inherit: "currentColor",
  muted: "var(--vui-color-muted)",
  accent: "var(--vui-color-accent)",
  danger: "var(--vui-color-danger)",
  inverse: "var(--vui-color-page)",
};
export function FileIcon({ variant = "inherit", size = "md", strokeWidth = 1.4, ...props }: FileIconProps) {
  const pixelSize = sizes[size];
  return (
    <svg width={pixelSize} height={pixelSize} viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false" {...props}>
      <path d="M15 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-5-5Z" stroke={colors[variant]} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" />
      <path d="M14 3v4a2 2 0 0 0 2 2h4" stroke={colors[variant]} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
