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
  const user = useAuthStore((state) => state.user);
  const teamKey = useAuthStore((state) => String(state.team?.key ?? ""));
  const scopeKey = useAuthStore((state) => String(state.scope?.key ?? ""));
  const notifications = useQuery({ queryKey: notificationQueryKey(String(user?.key ?? ""), teamKey), queryFn: () => listNotifications({ teamKey, scopeKey }), enabled: Boolean(user?.key && teamKey && scopeKey), refetchInterval: 30_000 });
  return <Button accessibilityLabel="Open profile" contentMode="raw" iconOnly size="md" variant="ghost" {...props}>
    <Avatar fallback={profileInitial(user)} size={avatarSize} style={styles.avatar} uri={user?.avatarUrl} />
    {(notifications.data?.unreadCount ?? 0) > 0 ? <Badge pointerEvents="none" style={styles.notificationBadge}><Text style={styles.notificationBadgeText}>{Math.min(notifications.data!.unreadCount, 99)}</Text></Badge> : null}
  </Button>;
}

export function ProfileHeaderRight() {
  const router = useRouter();
  const userKey = useAuthStore((state) => state.user?.key);
  const balance = useWholeSparkBalance(userKey).data;
  const openSparksSheet = useUiStore((state) => state.openSparksSheet);
  const displayBalance = formatWholeSparks(balance ?? 0);
  return <View style={styles.headerRight}>
    <Button accessibilityLabel={balance === undefined ? "Sparks balance unavailable. Showing 0 Sparks. Open Sparks information" : `Sparks balance: ${balance} Sparks. Open Sparks information`} contentMode="raw" hitSlop={8} onPress={() => openSparksSheet("manual")} size="xs" style={styles.balanceButton} variant="ghost">
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
  notificationBadge: { alignItems: "center", backgroundColor: palette.danger, borderColor: palette.page, borderWidth: 2, height: 18, justifyContent: "center", minWidth: 18, paddingHorizontal: 3, position: "absolute", right: 0, top: 0 },
  notificationBadgeText: { color: palette.silver50, fontFamily: fonts.medium, fontSize: 9 },
});
