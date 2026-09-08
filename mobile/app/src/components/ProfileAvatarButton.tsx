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
import { listNotifications, notificationQueryKey } from "@/lib/notification-client";
import { useQuery } from "@tanstack/react-query";
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
  const teamKey = useAuthStore((state) => String(state.team?.key ?? ""));
  const scopeKey = useAuthStore((state) => String(state.scope?.key ?? ""));
  const notifications = useQuery({ queryKey: notificationQueryKey(String(user?.key ?? ""), teamKey), queryFn: () => listNotifications({ teamKey, scopeKey }), enabled: Boolean(user?.key && teamKey && scopeKey), refetchInterval: 30_000 });
  return <View style={[styles.avatarFrame, { height: avatarSize, width: avatarSize }]}>
    <Avatar fallback={profileInitial(user)} size={avatarSize} style={styles.avatar} uri={user?.avatarUrl} />
    {(notifications.data?.unreadCount ?? 0) > 0 ? <Badge pointerEvents="none" style={styles.notificationBadge}><Text style={styles.notificationBadgeText}>{Math.min(notifications.data!.unreadCount, 99)}</Text></Badge> : null}
  </View>;
}

export function SparksBalanceButton() {
  const userKey = useAuthStore((state) => state.user?.key);
  const balance = useWholeSparkBalance(userKey).data;
  const openPaywall = useUiStore((state) => state.openPaywall);
  const displayBalance = formatWholeSparks(balance ?? 0);
  return <Button accessibilityLabel={balance === undefined ? "Sparks balance unavailable. Showing 0 Sparks. Open Sparks" : `Sparks balance: ${balance} Sparks. Open Sparks`} hitSlop={8} onPress={openPaywall} size="xs" textStyle={styles.balanceText} variant="secondary">{displayBalance} Sparks</Button>;
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
  notificationBadge: { alignItems: "center", backgroundColor: palette.danger, borderColor: palette.voidBlack, borderWidth: 2, height: 18, justifyContent: "center", minWidth: 18, paddingHorizontal: 3, position: "absolute", right: 0, top: 0 },
  notificationBadgeText: { color: palette.silver50, fontFamily: fonts.medium, fontSize: 9 },
});
