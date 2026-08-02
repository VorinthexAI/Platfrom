import type { SVGProps } from "react";

export type CheckboxIconVariant = "default" | "inherit" | "muted" | "accent" | "danger" | "inverse";
export type CheckboxIconSize = "sm" | "md" | "lg";
export type CheckboxIconProps = Omit<SVGProps<SVGSVGElement>, "color"> & {
  checked?: boolean;
  variant?: CheckboxIconVariant;
  size?: CheckboxIconSize;
};

const sizes: Record<CheckboxIconSize, number> = { sm: 16, md: 20, lg: 24 };
const colors: Record<CheckboxIconVariant, string> = {
  default: "var(--vui-color-text)",
  inherit: "currentColor",
  muted: "var(--vui-color-muted)",
  accent: "var(--vui-color-accent)",
  danger: "var(--vui-color-danger)",
  inverse: "var(--vui-color-page)",
};

export function CheckboxIcon({ checked = false, variant = "inherit", size = "md", strokeWidth = 1.4, ...props }: CheckboxIconProps) {
  const pixelSize = sizes[size];
  const color = colors[variant];
  return (
    <svg width={pixelSize} height={pixelSize} viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false" {...props}>
      <rect x="4.5" y="4.5" width="15" height="15" rx="3" stroke={color} strokeWidth={strokeWidth} />
      {checked ? <path d="m8 12.5 2.7 2.7L16.5 9" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" /> : null}
    </svg>
  );
}
