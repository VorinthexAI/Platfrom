import type { SVGProps } from "react";

export type LinkOffIconSize = "sm" | "md" | "lg" | "xl";
export type LinkOffIconProps = SVGProps<SVGSVGElement> & { size?: LinkOffIconSize };

const sizes: Record<LinkOffIconSize, number> = { sm: 16, md: 20, lg: 24, xl: 64 };

export function LinkOffIcon({ size = "md", ...props }: LinkOffIconProps) {
  return <svg width={sizes[size]} height={sizes[size]} viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false" {...props}>
    <path d="M9 15l-1.5 1.5a3.5 3.5 0 0 1-5-5L6 8a3.5 3.5 0 0 1 4.5-.4M15 9l1.5-1.5a3.5 3.5 0 0 1 5 5L18 16a3.5 3.5 0 0 1-4.5.4M3 3l18 18" stroke="var(--vui-color-accent)" strokeWidth={1.4} strokeLinecap="round" strokeLinejoin="round" />
  </svg>;
}
