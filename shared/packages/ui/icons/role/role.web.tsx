import type { SVGProps } from "react";

export type RoleIconRole = "general" | "research" | "writing" | "marketing" | "learning" | "engineering" | "data" | "design" | "business" | "finance" | "legal" | "health";
export type RoleIconProps = Omit<SVGProps<SVGSVGElement>, "color"> & { role: RoleIconRole; size?: "sm" | "md" | "lg" };
const sizes = { sm: 16, md: 20, lg: 24 };

export function RoleIcon({ role, size = "md", ...props }: RoleIconProps) {
  const drawing = (() => {
    switch (role) {
      case "research": return <><circle cx="10.5" cy="10.5" r="6" /><path d="m15 15 5 5" /></>;
      case "writing": return <><path d="m4 20 4.5-1 10-10a2.1 2.1 0 0 0-3-3l-10 10L4 20Z" /><path d="m14 7 3 3M4 20l4.5-1" /></>;
      case "marketing": return <path d="M4 10h4l10-5v14L8 14H4v-4ZM8 14l1.5 6h3L11 15.5M20 9a4 4 0 0 1 0 6" />;
      case "learning": return <path d="M12 6c-2-1.6-5-1.7-9-1v14c4-.7 7-.6 9 1 2-1.6 5-1.7 9-1V5c-4-.7-7-.6-9 1ZM12 6v14" />;
      case "engineering": return <path d="m8 6-5 6 5 6m8-12 5 6-5 6m-2-14-4 16" />;
      case "data": return <path d="M4 20V11h4v9m4 0V5h4v15m4 0v-7h3v7M2 20h21" />;
      case "design": return <><path d="M12 3a9 9 0 1 0 0 18h2a2 2 0 0 0 1.5-3.4 1.8 1.8 0 0 1 1.3-3.1H19A3 3 0 0 0 22 11a10 10 0 0 0-10-8Z" /><circle cx="7" cy="11" r=".8" fill="currentColor" /><circle cx="10" cy="7" r=".8" fill="currentColor" /><circle cx="15" cy="7" r=".8" fill="currentColor" /></>;
      case "business": return <><rect x="3" y="8" width="18" height="13" rx="2" /><path d="M8 8V6a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M3 13c5 3 13 3 18 0M10 15h4" /></>;
      case "finance": return <><circle cx="12" cy="12" r="9" /><path d="M15 8H10a2 2 0 0 0 0 4h4a2 2 0 0 1 0 4H9m3-10v12" /></>;
      case "legal": return <path d="M12 3v17M6 6h12M5 20h14M6 6l-3 6h6L6 6Zm12 0-3 6h6l-3-6Z" />;
      case "health": return <><path d="M20.5 9c0 4.8-8.5 10-8.5 10S3.5 13.8 3.5 9a4.5 4.5 0 0 1 8.5-2 4.5 4.5 0 0 1 8.5 2Z" /><path d="M7 12h3l1.3-2.5 2 5 1.2-2.5H17" /></>;
      default: return <><circle cx="12" cy="12" r="9" /><path d="m15 9-2 4-4 2 2-4 4-2Z" /></>;
    }
  })();
  return <svg width={sizes[size]} height={sizes[size]} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false" {...props}>{drawing}</svg>;
}
