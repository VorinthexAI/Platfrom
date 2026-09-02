import type { CSSProperties, ImgHTMLAttributes } from "react";

export type ChromeIconProps = Omit<ImgHTMLAttributes<HTMLImageElement>, "height" | "src" | "width"> & {
  source: string;
  size: number;
  glow?: number;
};

export function ChromeIcon({ source, size, glow = 0.55, className = "", style, ...props }: ChromeIconProps) {
  return <span className={`vui-chrome-icon ${className}`} style={{ ...style, "--vui-chrome-icon-glow": glow, height: size, width: size } as CSSProperties}>
    <img alt="" height={size} src={source} width={size} {...props} />
  </span>;
}
