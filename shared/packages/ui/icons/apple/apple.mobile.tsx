import Svg, { Path } from "react-native-svg";

export type AppleIconProps = { color?: string; size?: number };

export function AppleIcon({ color = "#F5F7F8", size = 20 }: AppleIconProps) {
  return (
    <Svg height={size} viewBox="0 0 24 24" width={size}>
      <Path d="M17.05 12.54c-.02-2.3 1.88-3.42 1.97-3.47a4.23 4.23 0 0 0-3.33-1.8c-1.4-.15-2.76.84-3.47.84-.72 0-1.8-.82-2.98-.8a4.4 4.4 0 0 0-3.7 2.26c-1.61 2.79-.41 6.9 1.13 9.15.77 1.1 1.67 2.34 2.85 2.3 1.15-.05 1.58-.74 2.97-.74 1.37 0 1.78.74 2.98.71 1.24-.02 2.01-1.1 2.75-2.21a9.14 9.14 0 0 0 1.26-2.57 3.96 3.96 0 0 1-2.43-3.67ZM14.78 5.78A4.05 4.05 0 0 0 15.7 2.9a4.1 4.1 0 0 0-2.66 1.37 3.87 3.87 0 0 0-.95 2.77 3.4 3.4 0 0 0 2.69-1.26Z" fill={color} />
    </Svg>
  );
}
