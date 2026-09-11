import type { SVGProps } from "react";

export type FeedbackIconVariant = "default" | "inherit" | "muted" | "accent" | "danger" | "inverse";
export type FeedbackIconSize = "sm" | "md" | "lg";
export type FeedbackIconProps = Omit<SVGProps<SVGSVGElement>, "color"> & { variant?: FeedbackIconVariant; size?: FeedbackIconSize };

const sizes: Record<FeedbackIconSize, number> = { sm: 16, md: 20, lg: 24 };
const colors: Record<FeedbackIconVariant, string> = {
  default: "var(--vui-color-text)",
  inherit: "currentColor",
  muted: "var(--vui-color-muted)",
  accent: "var(--vui-color-accent)",
  danger: "var(--vui-color-danger)",
  inverse: "var(--vui-color-page)",
};

export function FeedbackIcon({ variant = "inherit", size = "md", strokeWidth = 1.4, ...props }: FeedbackIconProps) {
  const pixelSize = sizes[size];
  const color = colors[variant];
  return (
    <svg width={pixelSize} height={pixelSize} viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false" {...props}>
      <path d="M4 5.5h16v11H9l-5 4v-15Z" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" />
      <path d="M8 10h8M8 13h5" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" />
    </svg>
  );
}
