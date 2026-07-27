import type { SVGProps } from "react";

export type SoundwaveIconVariant = "default" | "inherit" | "muted" | "accent" | "danger" | "inverse";
export type SoundwaveIconSize = "sm" | "md" | "lg";
export type SoundwaveIconProps = Omit<SVGProps<SVGSVGElement>, "color"> & {
  variant?: SoundwaveIconVariant;
  size?: SoundwaveIconSize;
  animated?: boolean;
};

const sizes: Record<SoundwaveIconSize, number> = { sm: 16, md: 20, lg: 24 };
const colors: Record<SoundwaveIconVariant, string> = {
  default: "var(--vui-color-text)", inherit: "currentColor", muted: "var(--vui-color-muted)",
  accent: "var(--vui-color-accent)", danger: "var(--vui-color-danger)", inverse: "var(--vui-color-page)",
};

export function SoundwaveIcon({ variant = "inherit", size = "md", strokeWidth = 1.8, animated = false, ...props }: SoundwaveIconProps) {
  const animation = animated ? "soundwave-bar 720ms ease-in-out infinite alternate" : undefined;
  return (
    <svg width={sizes[size]} height={sizes[size]} viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false" {...props}>
      {[6, 9, 12, 15, 18].map((x, index) => {
        const halfHeight = [3, 6, 8, 6, 3][index]!;
        return <path key={x} d={`M${x} ${12 - halfHeight}v${halfHeight * 2}`} stroke={colors[variant]} strokeWidth={strokeWidth} strokeLinecap="round" style={{ transformBox: "fill-box", transformOrigin: "center", animation, animationDelay: `${index * -90}ms` }} />;
      })}
    </svg>
  );
}
