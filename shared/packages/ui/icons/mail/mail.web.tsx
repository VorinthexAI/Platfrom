import type { SVGProps } from "react";
export type MailIconVariant = "default" | "inherit" | "muted" | "accent" | "danger" | "inverse";
export type MailIconSize = "sm" | "md" | "lg";
export type MailIconProps = Omit<SVGProps<SVGSVGElement>, "color"> & {
  variant?: MailIconVariant;
  size?: MailIconSize;
};
const sizes: Record<MailIconSize, number> = { sm: 16, md: 20, lg: 24 };
const colors: Record<MailIconVariant, string> = {
  default: "var(--vui-color-text)",
  inherit: "currentColor",
  muted: "var(--vui-color-muted)",
  accent: "var(--vui-color-accent)",
  danger: "var(--vui-color-danger)",
  inverse: "var(--vui-color-page)",
};
export function MailIcon({ variant = "inherit", size = "md", strokeWidth = 1.4, ...props }: MailIconProps) {
  const pixelSize = sizes[size];
  return (
    <svg width={pixelSize} height={pixelSize} viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false" {...props}>
      <path d="M4.5 6.75h15v10.5h-15z" stroke={colors[variant]} strokeWidth={strokeWidth} strokeLinejoin="round" />
      <path d="m5 7.25 7 5.5 7-5.5" stroke={colors[variant]} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
