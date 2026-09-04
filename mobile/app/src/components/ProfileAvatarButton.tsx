import { useRouter } from "expo-router";
import { Avatar } from "@vorinthex/shared/ui/avatar";
import { Badge } from "@vorinthex/shared/ui/badge";
import { Button } from "@vorinthex/shared/ui/button";
import type { ComponentProps } from "react";
import { StyleSheet, Text, View } from "react-native";

import { useAuthStore } from "@/state/auth";
import { profileInitial } from "@/lib/auth-helpers";
import { formatWholeSparks } from "@/lib/billing-client";
import { useWholeSparkBalance } from "@/hooks/use-billing-summary";
import { useUiStore } from "@/state/ui";
import { fonts, palette } from "@/theme/tokens";

type ProfileAvatarButtonProps = Omit<ComponentProps<typeof Button>, "children" | "contentMode" | "iconOnly" | "size" | "variant"> & {
  avatarSize?: number;
};

export function ProfileAvatarButton({ avatarSize = 32, ...props }: ProfileAvatarButtonProps) {
  const user = useAuthStore((state) => state.user);
  return <Button accessibilityLabel="Open profile" contentMode="raw" iconOnly size="md" variant="ghost" {...props}>
    <Avatar fallback={profileInitial(user)} size={avatarSize} style={styles.avatar} uri={user?.avatarUrl} />
  </Button>;
}

export function ProfileHeaderRight() {
  const router = useRouter();
  const userKey = useAuthStore((state) => state.user?.key);
  const balance = useWholeSparkBalance(userKey).data;
  const openSparksSheet = useUiStore((state) => state.openSparksSheet);
  const displayBalance = balance === undefined ? "--" : formatWholeSparks(balance);
  return <View style={styles.headerRight}>
    <Button accessibilityLabel={balance === undefined ? "Sparks balance unavailable. Open Sparks information" : `Sparks balance: ${balance} Sparks. Open Sparks information`} contentMode="raw" hitSlop={8} onPress={() => openSparksSheet("manual")} size="xs" style={styles.balanceButton} variant="ghost">
      <Badge style={styles.balanceBadge}><Text style={styles.balanceText}>{displayBalance} Sparks</Text></Badge>
    </Button>
    <ProfileAvatarButton onPress={() => router.push("/profile")} />
  </View>;
}

const styles = StyleSheet.create({
  avatar: { borderColor: "#262D36", borderWidth: 1 },
  headerRight: { alignItems: "center", flexDirection: "row", gap: 4 },
  balanceButton: { paddingHorizontal: 0 },
  balanceBadge: { backgroundColor: palette.insetHighlight, borderWidth: 1, paddingHorizontal: 8, paddingVertical: 4 },
  balanceText: { color: palette.silver100, fontFamily: fonts.medium, fontSize: 11, letterSpacing: 0.2 },
});
