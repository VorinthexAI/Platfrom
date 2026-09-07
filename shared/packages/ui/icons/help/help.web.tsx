import type { SVGProps } from "react";
export type HelpIconVariant = "default" | "inherit" | "muted" | "accent" | "danger" | "inverse";
export type HelpIconSize = "sm" | "md" | "lg";
export type HelpIconProps = Omit<SVGProps<SVGSVGElement>, "color"> & {
  variant?: HelpIconVariant;
  size?: HelpIconSize;
};
const sizes: Record<HelpIconSize, number> = { sm: 16, md: 20, lg: 24 };
const colors: Record<HelpIconVariant, string> = {
  default: "var(--vui-color-text)",
  inherit: "currentColor",
  muted: "var(--vui-color-muted)",
  accent: "var(--vui-color-accent)",
  danger: "var(--vui-color-danger)",
  inverse: "var(--vui-color-page)",
};
export function HelpIcon({ variant = "inherit", size = "md", strokeWidth = 1.4, ...props }: HelpIconProps) {
  const pixelSize = sizes[size];
  return (
    <svg width={pixelSize} height={pixelSize} viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false" {...props}>
      <circle cx="12" cy="12" r="9" stroke={colors[variant]} strokeWidth={strokeWidth} />
      <path d="M9.75 9a2.4 2.4 0 1 1 3.4 2.18c-.72.36-1.15.88-1.15 1.82" stroke={colors[variant]} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" />
      <path d="M12 16.5h.01" stroke={colors[variant]} strokeWidth={Number(strokeWidth) + 0.6} strokeLinecap="round" />
    </svg>
  );
}
