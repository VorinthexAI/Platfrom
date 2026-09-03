import { Image } from "expo-image";
import { useEffect, useState, type ReactNode } from "react";
import { StyleSheet, Text, View, type ViewProps } from "react-native";

export type AvatarProps = ViewProps & {
  children?: ReactNode;
  fallback?: string;
  size?: number;
  uri?: string;
};

export function Avatar({ children, fallback = "", size = 40, style, uri, ...props }: AvatarProps) {
  const [failedUri, setFailedUri] = useState<string>();
  useEffect(() => setFailedUri(undefined), [uri]);
  const showImage = Boolean(uri && failedUri !== uri);

  return <View style={[styles.root, { height: size, width: size }, style]} {...props}>
    {children ?? (showImage
      ? <Image contentFit="cover" onError={() => setFailedUri(uri)} source={{ uri }} style={StyleSheet.absoluteFill} transition={0} />
      : <Text numberOfLines={1} style={[styles.fallback, { fontSize: Math.max(12, Math.round(size * 0.38)) }]}>{fallback.slice(0, 1).toLocaleUpperCase()}</Text>)}
  </View>;
}
const styles = StyleSheet.create({
  root: {
    alignItems: "center",
    backgroundColor: "#10151B",
    borderRadius: 999,
    justifyContent: "center",
    overflow: "hidden",
  },
  fallback: { color: "#DDE2E5", fontFamily: "Geist_500Medium" },
});
