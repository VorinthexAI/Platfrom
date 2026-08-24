import type { SVGProps } from "react";

export type MicrosoftIconProps = SVGProps<SVGSVGElement> & { size?: number };

export function MicrosoftIcon({ size = 20, ...props }: MicrosoftIconProps) {
  return (
    <svg aria-hidden="true" focusable="false" height={size} viewBox="0 0 24 24" width={size} {...props}>
      <path d="M2 2h9.5v9.5H2V2Z" fill="#F25022" />
      <path d="M12.5 2H22v9.5h-9.5V2Z" fill="#7FBA00" />
      <path d="M2 12.5h9.5V22H2v-9.5Z" fill="#00A4EF" />
      <path d="M12.5 12.5H22V22h-9.5v-9.5Z" fill="#FFB900" />
    </svg>
  );
}
