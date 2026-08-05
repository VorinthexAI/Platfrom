import type { SVGProps } from "react";
export type StarIconVariant = "default" | "inherit" | "muted" | "accent" | "danger" | "inverse";
export type StarIconSize = "sm" | "md" | "lg";
export type StarIconProps = Omit<SVGProps<SVGSVGElement>, "color"> & {
  variant?: StarIconVariant;
  size?: StarIconSize;
};
const sizes: Record<StarIconSize, number> = { sm: 16, md: 20, lg: 24 };
const colors: Record<StarIconVariant, string> = {
  default: "var(--vui-color-text)",
  inherit: "currentColor",
  muted: "var(--vui-color-muted)",
  accent: "var(--vui-color-accent)",
  danger: "var(--vui-color-danger)",
  inverse: "var(--vui-color-page)",
};
export function StarIcon({ variant = "inherit", size = "md", strokeWidth = 1.4, ...props }: StarIconProps) {
  const pixelSize = sizes[size];
  return (
    <svg width={pixelSize} height={pixelSize} viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false" {...props}>
      <path d="m12 3 2.65 5.37 5.93.86-4.29 4.18 1.01 5.9L12 16.52l-5.3 2.79 1.01-5.9-4.29-4.18 5.93-.86L12 3Z" stroke={colors[variant]} strokeWidth={strokeWidth} strokeLinejoin="round" />
      <circle cx="12" cy="11.6" r="1.55" stroke={colors[variant]} strokeWidth={strokeWidth} />
    </svg>
  );
}
