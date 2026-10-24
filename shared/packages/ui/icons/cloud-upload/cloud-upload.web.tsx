import type { SVGProps } from "react";
export type CloudUploadIconVariant = "default" | "inherit" | "muted" | "accent" | "danger" | "inverse";
export type CloudUploadIconSize = "sm" | "md" | "lg";
export type CloudUploadIconProps = Omit<SVGProps<SVGSVGElement>, "color"> & { variant?: CloudUploadIconVariant; size?: CloudUploadIconSize };
const sizes: Record<CloudUploadIconSize, number> = { sm: 16, md: 20, lg: 24 };
const colors: Record<CloudUploadIconVariant, string> = { default: "var(--vui-color-text)", inherit: "currentColor", muted: "var(--vui-color-muted)", accent: "var(--vui-color-accent)", danger: "var(--vui-color-danger)", inverse: "var(--vui-color-page)" };
export function CloudUploadIcon({ variant = "inherit", size = "md", strokeWidth = 1.4, ...props }: CloudUploadIconProps) {
  const pixelSize = sizes[size];
  const color = colors[variant];
  return (
    <svg width={pixelSize} height={pixelSize} viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false" {...props}>
      <path d="M7.2 17.5h-.4A4.3 4.3 0 0 1 7 9a5.2 5.2 0 0 1 10-.6 3.6 3.6 0 0 1 .8 7.1h-.6" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" />
      <path d="M12 19.5v-7" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" />
      <path d="M9.2 14.2 12 11.4l2.8 2.8" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
