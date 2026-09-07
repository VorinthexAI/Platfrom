import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ActionPill } from "@vorinthex/shared/ui/action-pill";
import { BottomSheet } from "@vorinthex/shared/ui/bottom-sheet";
import { Button } from "@vorinthex/shared/ui/button";
import { useRouter } from "expo-router";
import { useEffect } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";

import { listNotifications, notificationQueryKey } from "@/lib/notification-client";
import { useAuthStore } from "@/state/auth";
import { fonts, palette, spacing } from "@/theme/tokens";

export default function NotificationsRoute() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const userKey = useAuthStore((state) => String(state.user?.key ?? ""));
  const teamKey = useAuthStore((state) => String(state.team?.key ?? ""));
  const scopeKey = useAuthStore((state) => String(state.scope?.key ?? ""));
  const query = useQuery({ queryKey: notificationQueryKey(userKey, teamKey), queryFn: () => listNotifications({ teamKey, scopeKey }), enabled: Boolean(userKey && teamKey && scopeKey) });

  useEffect(() => {
    if (!userKey || !teamKey || !scopeKey) return;
    const queryKey = notificationQueryKey(userKey, teamKey);
    void (async () => {
      await queryClient.cancelQueries({ queryKey });
      const result = await listNotifications({ teamKey, scopeKey, markRead: true });
      queryClient.setQueryData(queryKey, result);
    })().catch(() => undefined);
  }, [teamKey, queryClient, scopeKey, userKey]);

  return <View style={styles.root}>
    <BottomSheet height="full" onDismissRequest={() => router.back()} onOpenChange={() => undefined} open title="Notifications">
      <ScrollView contentContainerStyle={styles.list}>
        {query.isPending ? <Text style={styles.state}>Loading notifications...</Text> : query.isError ? <View style={styles.stateContainer}><Text style={styles.state}>Notifications could not be loaded.</Text><Button onPress={() => void query.refetch()} size="md" variant="secondary">Retry</Button></View> : query.data?.items.length ? query.data.items.map((item) => <ActionPill key={item.key} style={styles.pill}>
          <View style={styles.pillContent}><View style={styles.titleRow}><Text numberOfLines={1} style={styles.title}>{item.title}</Text><Text style={styles.time}>{new Date(item.createdAt).toLocaleDateString()}</Text></View><Text style={styles.message}>{item.message}</Text></View>
        </ActionPill>) : <Text style={styles.state}>No notifications yet.</Text>}
      </ScrollView>
    </BottomSheet>
  </View>;
}

const styles = StyleSheet.create({
  root: { backgroundColor: palette.page, flex: 1 },
  list: { flexGrow: 1, gap: spacing.sm, paddingBottom: spacing.lg },
  pill: { borderRadius: 18, minHeight: 76 },
  pillContent: { gap: 5, paddingVertical: 8, width: "100%" },
  titleRow: { alignItems: "center", flexDirection: "row", gap: spacing.sm, justifyContent: "space-between" },
  title: { color: palette.silver50, flex: 1, fontFamily: fonts.medium, fontSize: 14 },
  message: { color: palette.silver300, fontFamily: fonts.regular, fontSize: 13, lineHeight: 19 },
  time: { color: palette.silver500, fontFamily: fonts.regular, fontSize: 10 },
  stateContainer: { alignItems: "center", gap: spacing.md, justifyContent: "center" },
  state: { color: palette.silver500, fontFamily: fonts.regular, fontSize: 14, paddingVertical: spacing.xl, textAlign: "center" },
});
