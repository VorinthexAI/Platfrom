import Svg, { Circle, Path, Rect } from "react-native-svg";

export type RoleIconRole = "general" | "research" | "writing" | "marketing" | "learning" | "engineering" | "data" | "design" | "business" | "finance" | "legal" | "health";
export type RoleIconProps = { role: RoleIconRole; size?: "sm" | "md" | "lg" };
const sizes = { sm: 16, md: 20, lg: 24 };

export function RoleIcon({ role, size = "md" }: RoleIconProps) {
  const common = { stroke: "#F5F7F8", strokeWidth: 1.5, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  const drawing = (() => {
    switch (role) {
      case "research": return <><Circle cx="10.5" cy="10.5" r="6" {...common} /><Path d="m15 15 5 5" {...common} /></>;
      case "writing": return <><Path d="m4 20 4.5-1 10-10a2.1 2.1 0 0 0-3-3l-10 10L4 20Z" {...common} /><Path d="m14 7 3 3M4 20l4.5-1" {...common} /></>;
      case "marketing": return <><Path d="M4 10h4l10-5v14L8 14H4v-4ZM8 14l1.5 6h3L11 15.5M20 9a4 4 0 0 1 0 6" {...common} /></>;
      case "learning": return <><Path d="M12 6c-2-1.6-5-1.7-9-1v14c4-.7 7-.6 9 1 2-1.6 5-1.7 9-1V5c-4-.7-7-.6-9 1ZM12 6v14" {...common} /></>;
      case "engineering": return <><Path d="m8 6-5 6 5 6m8-12 5 6-5 6m-2-14-4 16" {...common} /></>;
      case "data": return <><Path d="M4 20V11h4v9m4 0V5h4v15m4 0v-7h3v7M2 20h21" {...common} /></>;
      case "design": return <><Path d="M12 3a9 9 0 1 0 0 18h2a2 2 0 0 0 1.5-3.4 1.8 1.8 0 0 1 1.3-3.1H19A3 3 0 0 0 22 11a10 10 0 0 0-10-8Z" {...common} /><Circle cx="7" cy="11" r=".8" fill="#F5F7F8" /><Circle cx="10" cy="7" r=".8" fill="#F5F7F8" /><Circle cx="15" cy="7" r=".8" fill="#F5F7F8" /></>;
      case "business": return <><Rect x="3" y="8" width="18" height="13" rx="2" {...common} /><Path d="M8 8V6a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M3 13c5 3 13 3 18 0M10 15h4" {...common} /></>;
      case "finance": return <><Circle cx="12" cy="12" r="9" {...common} /><Path d="M15 8H10a2 2 0 0 0 0 4h4a2 2 0 0 1 0 4H9m3-10v12" {...common} /></>;
      case "legal": return <><Path d="M12 3v17M6 6h12M5 20h14M6 6l-3 6h6L6 6Zm12 0-3 6h6l-3-6Z" {...common} /></>;
      case "health": return <><Path d="M20.5 9c0 4.8-8.5 10-8.5 10S3.5 13.8 3.5 9a4.5 4.5 0 0 1 8.5-2 4.5 4.5 0 0 1 8.5 2Z" {...common} /><Path d="M7 12h3l1.3-2.5 2 5 1.2-2.5H17" {...common} /></>;
      default: return <><Circle cx="12" cy="12" r="9" {...common} /><Path d="m15 9-2 4-4 2 2-4 4-2Z" {...common} /></>;
    }
  })();
  return <Svg width={sizes[size]} height={sizes[size]} viewBox="0 0 24 24" fill="none">{drawing}</Svg>;
}
