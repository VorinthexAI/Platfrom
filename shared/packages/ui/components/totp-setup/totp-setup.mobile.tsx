import { Image } from "expo-image";
import { Linking, StyleSheet, Text, View, type ViewStyle } from "react-native";
import type { ReactNode } from "react";

import { Button } from "../button/button.mobile";

export type TotpSetupProps = {
  accountLabel?: string;
  children?: ReactNode;
  deepLinkLabel?: string;
  issuerLabel?: string;
  otpauthUri: string;
  qrCodeImageSrc: string;
  style?: ViewStyle;
};

export function isValidTotpUri(value: string) {
  try {
    const uri = new URL(value);
    return uri.protocol === "otpauth:" && uri.hostname === "totp" && Boolean(uri.pathname.replace(/^\//, ""));
  } catch { return false; }
}

export function TotpSetup({ accountLabel, children, deepLinkLabel = "Open authenticator app", issuerLabel = "Authenticator app", otpauthUri, qrCodeImageSrc, style }: TotpSetupProps) {
  const openAuthenticator = async () => {
    if (!isValidTotpUri(otpauthUri) || !await Linking.canOpenURL(otpauthUri)) return;
    await Linking.openURL(otpauthUri);
  };
  return <View style={[styles.root, style]}>
    <View style={styles.copy}><Text style={styles.label}>Two-factor setup</Text><Text accessibilityRole="header" style={styles.title}>Scan the QR code</Text><Text style={styles.body}>Add this sign-in method to {issuerLabel}{accountLabel ? ` for ${accountLabel}` : ""}.</Text></View>
    <View accessibilityLabel="TOTP setup QR code" style={styles.qr}><Image accessibilityLabel="Scan this QR code with your authenticator app" contentFit="contain" source={{ uri: qrCodeImageSrc }} style={styles.image} /></View>
    <Button disabled={!isValidTotpUri(otpauthUri)} onPress={() => void openAuthenticator()} size="md" variant="primary">{deepLinkLabel}</Button>
    {children ? <View style={styles.extra}>{children}</View> : null}
  </View>;
}

const styles = StyleSheet.create({
  root: { alignItems: "center", gap: 18, width: "100%" },
  copy: { alignItems: "center", gap: 8 },
  label: { color: "#7D898C", fontSize: 10, letterSpacing: 1.6, textTransform: "uppercase" },
  title: { color: "#EFF0ED", fontSize: 26, textAlign: "center" },
  body: { color: "#969F9F", fontSize: 14, lineHeight: 21, textAlign: "center" },
  qr: { backgroundColor: "#FFFFFF", borderRadius: 16, padding: 12 },
  image: { height: 220, width: 220 },
  extra: { alignSelf: "stretch", gap: 14 },
});
