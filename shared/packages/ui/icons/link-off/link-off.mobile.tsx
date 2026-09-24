import Svg, { Path } from "react-native-svg";

export type LinkOffIconSize = "sm" | "md" | "lg" | "xl";
export type LinkOffIconProps = { size?: LinkOffIconSize };

const sizes: Record<LinkOffIconSize, number> = { sm: 16, md: 20, lg: 24, xl: 64 };

export function LinkOffIcon({ size = "md" }: LinkOffIconProps) {
  return <Svg width={sizes[size]} height={sizes[size]} viewBox="0 0 24 24" fill="none">
    <Path d="M9 15l-1.5 1.5a3.5 3.5 0 0 1-5-5L6 8a3.5 3.5 0 0 1 4.5-.4M15 9l1.5-1.5a3.5 3.5 0 0 1 5 5L18 16a3.5 3.5 0 0 1-4.5.4M3 3l18 18" stroke="#DDE2E5" strokeWidth={1.4} strokeLinecap="round" strokeLinejoin="round" />
  </Svg>;
}
