import type { ImgHTMLAttributes } from "react";

import { cn } from "../../utils";

export type AvatarProps = ImgHTMLAttributes<HTMLImageElement> & {
  fallback?: string;
};

export function Avatar({ alt = "", className, fallback, src, ...props }: AvatarProps) {
  if (!src) {
    return (
      <span className={cn("inline-flex h-10 w-10 items-center justify-center rounded-full bg-secondary text-sm text-muted", className)}>
        {fallback ?? alt.slice(0, 2)}
      </span>
    );
  }

  // eslint-disable-next-line @next/next/no-img-element
  return <img alt={alt} className={cn("h-10 w-10 rounded-full object-cover", className)} src={src} {...props} />;
}
