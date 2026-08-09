import { ActivityIndicator, type ActivityIndicatorProps } from "react-native";

export type SpinnerProps = ActivityIndicatorProps & {
  variant?: "default" | "muted" | "inverse";
};

const colors = {
  default: "#DDE2E5",
  muted: "#AEB6BC",
  inverse: "#030507",
} as const;

export function Spinner({ color, variant = "default", ...props }: SpinnerProps) {
  return <ActivityIndicator color={color ?? colors[variant]} {...props} />;
}
