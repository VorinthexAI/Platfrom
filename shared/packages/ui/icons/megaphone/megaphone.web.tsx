import type { SVGProps } from "react";
export type MegaphoneIconVariant = "default" | "inherit" | "muted" | "accent" | "danger" | "inverse";
export type MegaphoneIconSize = "sm" | "md" | "lg";
export type MegaphoneIconProps = Omit<SVGProps<SVGSVGElement>, "color"> & { variant?: MegaphoneIconVariant; size?: MegaphoneIconSize };
const sizes: Record<MegaphoneIconSize, number> = { sm: 16, md: 20, lg: 24 };
const colors: Record<MegaphoneIconVariant, string> = { default: "var(--vui-color-text)", inherit: "currentColor", muted: "var(--vui-color-muted)", accent: "var(--vui-color-accent)", danger: "var(--vui-color-danger)", inverse: "var(--vui-color-page)" };
export function MegaphoneIcon({ variant = "inherit", size = "md", strokeWidth = 1.4, ...props }: MegaphoneIconProps) {
  const pixelSize = sizes[size];
  const color = colors[variant];
  return (
    <svg width={pixelSize} height={pixelSize} viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false" {...props}>
      <path d="M4.5 9.5v5l3.2.6 1.3 4.2h2.2l-1.1-4.4 8.4 2.2V6.9L9.9 9.1 4.5 9.5Z" stroke={color} strokeWidth={strokeWidth} strokeLinejoin="round" />
      <path d="M18.6 10.2h1.4M18.6 13.8h1.4" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" />
    </svg>
  );
}
