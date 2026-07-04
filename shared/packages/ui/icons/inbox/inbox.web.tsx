import type { SVGProps } from "react";

export type InboxIconVariant = "default" | "muted" | "accent" | "danger" | "inverse";
export type InboxIconSize = "sm" | "md" | "lg";
export type InboxIconProps = Omit<SVGProps<SVGSVGElement>, "color"> & {
  variant?: InboxIconVariant;
  size?: InboxIconSize;
};

const sizes: Record<InboxIconSize, number> = { sm: 16, md: 20, lg: 24 };
const colors: Record<InboxIconVariant, string> = {
  default: "var(--vui-color-text)",
  muted: "var(--vui-color-muted)",
  accent: "var(--vui-color-accent)",
  danger: "var(--vui-color-danger)",
  inverse: "var(--vui-color-page)",
};

export function InboxIcon({
  variant = "default",
  size = "md",
  strokeWidth = 1.4,
  ...props
}: InboxIconProps) {
  const pixelSize = sizes[size];

  return (
    <svg
      aria-hidden="true"
      fill="none"
      focusable="false"
      height={pixelSize}
      viewBox="0 0 24 24"
      width={pixelSize}
      {...props}
    >
      <path
        d="M4.5 13.5 6.6 6.6A2.2 2.2 0 0 1 8.7 5h6.6a2.2 2.2 0 0 1 2.1 1.6l2.1 6.9v3.1a2.4 2.4 0 0 1-2.4 2.4H6.9a2.4 2.4 0 0 1-2.4-2.4v-3.1Z"
        stroke={colors[variant]}
        strokeLinejoin="round"
        strokeWidth={strokeWidth}
      />
      <path
        d="M4.8 13.5h4.1c.6 0 .9.3 1.1.8l.2.5c.2.5.6.8 1.2.8h1.2c.6 0 1-.3 1.2-.8l.2-.5c.2-.5.5-.8 1.1-.8h4.1"
        stroke={colors[variant]}
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={strokeWidth}
      />
    </svg>
  );
}
