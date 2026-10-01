import type { SVGProps } from "react";
export type IncognitoIconVariant = "default" | "inherit" | "muted" | "accent" | "danger" | "inverse";
export type IncognitoIconSize = "sm" | "md" | "lg";
export type IncognitoIconProps = Omit<SVGProps<SVGSVGElement>, "color"> & {
  variant?: IncognitoIconVariant;
  size?: IncognitoIconSize;
};
const sizes: Record<IncognitoIconSize, number> = { sm: 16, md: 20, lg: 24 };
const colors: Record<IncognitoIconVariant, string> = {
  default: "var(--vui-color-text)",
  inherit: "currentColor",
  muted: "var(--vui-color-muted)",
  accent: "var(--vui-color-accent)",
  danger: "var(--vui-color-danger)",
  inverse: "var(--vui-color-page)",
};
export function IncognitoIcon({ variant = "inherit", size = "md", strokeWidth = 1.4, ...props }: IncognitoIconProps) {
  const pixelSize = sizes[size];
  const color = colors[variant];
  return (
    <svg width={pixelSize} height={pixelSize} viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false" {...props}>
      <path d="M4 10.5h16" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" />
      <path d="M7.5 10.5c0-3.2 2-5.5 4.5-5.5s4.5 2.3 4.5 5.5" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" />
      <path d="M7 15.25a2.25 2.25 0 1 1-4.5 0 2.25 2.25 0 0 1 4.5 0Z" stroke={color} strokeWidth={strokeWidth} />
      <path d="M21.5 15.25a2.25 2.25 0 1 1-4.5 0 2.25 2.25 0 0 1 4.5 0Z" stroke={color} strokeWidth={strokeWidth} />
      <path d="M7 15.25h10" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" />
    </svg>
  );
}
