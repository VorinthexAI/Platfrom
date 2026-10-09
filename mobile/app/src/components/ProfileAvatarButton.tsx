import { useRouter } from "expo-router";
import { Avatar } from "@vorinthex/shared/ui/avatar";
import { Button } from "@vorinthex/shared/ui/button";
import { SparksIcon } from "@vorinthex/shared/ui/icons-mobile";
import type { ComponentProps } from "react";
import { StyleSheet, View } from "react-native";

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
  return <Button accessibilityLabel="Open profile" contentMode="raw" iconOnly size="md" variant="ghost" {...props}>
    <ProfileAvatar avatarSize={avatarSize} />
  </Button>;
}

export function ProfileAvatar({ avatarSize = 32 }: { avatarSize?: number }) {
  const user = useAuthStore((state) => state.user);
  return <View style={[styles.avatarFrame, { height: avatarSize, width: avatarSize }]}>
    <Avatar fallback={profileInitial(user)} size={avatarSize} style={styles.avatar} uri={user?.avatarUrl} />
  </View>;
}

export function SparksBalanceButton() {
  const userKey = useAuthStore((state) => state.user?.key);
  const access = useWholeSparkBalance(userKey).data;
  const openPaywall = useUiStore((state) => state.openPaywall);
  const unlimited = access?.unlimited === true;
  const displayBalance = unlimited ? "∞" : formatWholeSparks(access?.balance ?? 0);
  return <Button accessibilityLabel={access === undefined ? "Sparks balance unavailable. Showing 0 Sparks. Open Sparks" : unlimited ? "Unlimited Sparks. Open Sparks" : `Sparks balance: ${access.balance} Sparks. Open Sparks`} hitSlop={8} icon={<SparksIcon size="sm" />} onPress={openPaywall} size="xs" textStyle={styles.balanceText} variant="secondary">{unlimited ? displayBalance : `${displayBalance} Sparks`}</Button>;
}

export function ProfileHeaderRight() {
  const router = useRouter();
  return <View style={styles.headerRight}>
    <SparksBalanceButton />
    <ProfileAvatarButton onPress={() => router.push("/profile")} />
  </View>;
}

const styles = StyleSheet.create({
  avatar: { backgroundColor: palette.voidBlack, borderColor: "#262D36", borderWidth: 1 },
  avatarFrame: { position: "relative" },
  headerRight: { alignItems: "center", flexDirection: "row", gap: 4 },
  balanceText: { color: palette.silver100, fontFamily: fonts.medium, fontSize: 11, letterSpacing: 0.2 },
});
