import type { SVGProps } from "react";

export type IssueIconVariant = "default" | "inherit" | "muted" | "accent" | "danger" | "inverse";
export type IssueIconSize = "sm" | "md" | "lg";
export type IssueIconProps = Omit<SVGProps<SVGSVGElement>, "color"> & { variant?: IssueIconVariant; size?: IssueIconSize };

const sizes: Record<IssueIconSize, number> = { sm: 16, md: 20, lg: 24 };
const colors: Record<IssueIconVariant, string> = {
  default: "var(--vui-color-text)",
  inherit: "currentColor",
  muted: "var(--vui-color-muted)",
  accent: "var(--vui-color-accent)",
  danger: "var(--vui-color-danger)",
  inverse: "var(--vui-color-page)",
};

export function IssueIcon({ variant = "inherit", size = "md", strokeWidth = 1.4, ...props }: IssueIconProps) {
  const pixelSize = sizes[size];
  const color = colors[variant];
  return (
    <svg width={pixelSize} height={pixelSize} viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false" {...props}>
      <path d="M8.3 3.5h7.4l4.8 4.8v7.4l-4.8 4.8H8.3l-4.8-4.8V8.3l4.8-4.8Z" stroke={color} strokeWidth={strokeWidth} strokeLinejoin="round" />
      <path d="M12 7.5v5.7M12 16.5h.01" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" />
    </svg>
  );
}
