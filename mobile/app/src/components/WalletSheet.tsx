import { useInfiniteQuery } from "@tanstack/react-query";
import { Button, ButtonSizeProvider } from "@vorinthex/shared/ui/button";
import { HelpIcon } from "@vorinthex/shared/ui/icons-mobile";
import { Skeleton } from "@vorinthex/shared/ui/skeleton";
import { FlatList, StyleSheet, Text, View } from "react-native";

import { useBillingSummary, useCurrentSubscription } from "@/hooks/use-billing-summary";
import { fetchBillingSummary, formatSpentSparks, formatStorageSummary, formatWholeSparks, WALLET_HISTORY_PAGE_SIZE, walletHistoryQueryKey, wholeSparks } from "@/lib/billing-client";
import { subscriptionPresentation } from "@/lib/subscription-presentation";
import { useAppsStore } from "@/state/apps";
import { fonts, palette, spacing } from "@/theme/tokens";

const spendDateFormatter = new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false });

function formatSpendDate(value: string) {
  return spendDateFormatter.format(new Date(value)).replace(",", "");
}

function sparkLabel(amount: string) {
  return `${amount} ${amount === "1" || amount === "less than 1" ? "Spark" : "Sparks"}`;
}

// These priced actions are intentionally absent from the public Spark costs list.
const unlistedActionNames: Readonly<Record<string, string>> = {
  "place.find-city": "View city",
  "profile.badge.generate": "Generate a profile badge",
};

function spendName(toolSlug: string | undefined, charges: ReadonlyArray<{ key: string; name: string }>) {
  if (!toolSlug) return "Spark action";
  return charges.find((charge) => charge.key === toolSlug)?.name
    ?? unlistedActionNames[toolSlug]
    ?? toolSlug.replaceAll(/[.-]/g, " ").replace(/^./, (first) => first.toUpperCase());
}

export type WalletHelp = "storage" | "ai" | "actions";

function SectionHelp({ label, onPress }: { label: string; onPress: () => void }) {
  return <ButtonSizeProvider overrideParent size="sm"><Button accessibilityLabel={label} contentMode="raw" iconOnly onPress={onPress} size="sm" variant="icon"><HelpIcon size="sm" /></Button></ButtonSizeProvider>;
}

export function WalletSheet({ onOpenHelp, userKey }: { onOpenHelp: (help: WalletHelp) => void; userKey: string | undefined }) {
  const sparkCosts = useAppsStore((state) => state.sparkCosts);
  const products = useAppsStore((state) => state.products);
  const storageSparkCost = sparkCosts.find((charge) => charge.kind === "storage")?.sparkCost;
  const staticCharges = sparkCosts.filter((charge) => charge.kind === "static");
  const billingSummaryQuery = useBillingSummary(userKey);
  const subscriptionQuery = useCurrentSubscription(userKey);
  const subscription = subscriptionQuery.data;
  const subscriptionView = subscription ? subscriptionPresentation(subscription, products.find(({ key }) => key === subscription.productKey)) : undefined;
  const historyQuery = useInfiniteQuery({
    queryKey: walletHistoryQueryKey(userKey ?? "unauthenticated"),
    queryFn: ({ pageParam, signal }) => fetchBillingSummary({ limit: WALLET_HISTORY_PAGE_SIZE, kind: "tool", ...(pageParam ?? {}) }, signal),
    initialPageParam: undefined as { beforeCreatedAt: string; beforeKey: string } | undefined,
    getNextPageParam: (lastPage) => {
      const last = lastPage.transactions.at(-1);
      return lastPage.transactions.length === WALLET_HISTORY_PAGE_SIZE && last ? { beforeCreatedAt: last.createdAt, beforeKey: last.key } : undefined;
    },
    enabled: Boolean(userKey),
  });
  const spends = historyQuery.data?.pages.flatMap((page) => page.transactions) ?? [];
  const loadMore = () => {
    if (!historyQuery.hasNextPage || historyQuery.isFetchingNextPage) return;
    void historyQuery.fetchNextPage();
  };

  return <FlatList
      contentContainerStyle={styles.content}
      data={spends}
      keyExtractor={(item) => item.key}
      ListEmptyComponent={historyQuery.isPending ? <View accessibilityLabel="Loading action history" accessibilityRole="progressbar" style={styles.state}>{[0, 1, 2].map((key) => <Skeleton key={key} style={styles.listSkeleton} />)}</View> : historyQuery.isError ? <View style={styles.state}><Text accessibilityRole="alert" style={styles.error}>Action history could not be loaded.</Text><Button onPress={() => void historyQuery.refetch()} size="md" variant="secondary">Retry</Button></View> : <Text style={styles.empty}>No paid actions yet.</Text>}
      ListFooterComponent={historyQuery.isFetchNextPageError ? <Button onPress={() => void historyQuery.fetchNextPage()} size="md" variant="secondary">Retry more actions</Button> : historyQuery.isFetchingNextPage ? <Skeleton accessibilityLabel="Loading more actions" accessibilityRole="progressbar" style={styles.listSkeleton} /> : null}
      ListHeaderComponent={<View style={styles.header}>
        <View style={styles.section}>
          <Text style={styles.title}>Spark balance</Text>
          {billingSummaryQuery.isPending ? <Skeleton style={styles.summarySkeleton} /> : billingSummaryQuery.isError ? <Text accessibilityRole="alert" style={styles.summary}>Spark balance is unavailable.</Text> : <Text style={styles.summary}>{formatWholeSparks(wholeSparks(billingSummaryQuery.data.microSparkBalance))} Sparks</Text>}
        </View>
        <View style={styles.section}>
          <Text style={styles.title}>Subscription</Text>
          {subscriptionQuery.isPending ? <Skeleton style={styles.summarySkeleton} /> : subscriptionQuery.isError ? <View style={styles.state}><Text accessibilityRole="alert" style={styles.error}>Subscription status could not be loaded.</Text><Button onPress={() => void subscriptionQuery.refetch()} size="md" variant="secondary">Retry</Button></View> : subscriptionView ? <><Text style={styles.balance}>{subscriptionView.title}</Text><Text style={styles.summary}>{subscriptionView.copy}</Text></> : <Text style={styles.summary}>No current subscription.</Text>}
        </View>
        <View style={styles.section}>
          <View style={styles.titleRow}><Text style={styles.title}>{storageSparkCost ? `Storage (${storageSparkCost} Sparks / GB / Month)` : "Storage"}</Text><SectionHelp label="How is storage charged?" onPress={() => onOpenHelp("storage")} /></View>
          {billingSummaryQuery.isPending ? <Skeleton style={styles.summarySkeleton} /> : billingSummaryQuery.isError ? <Text accessibilityRole="alert" style={styles.summary}>Storage usage is unavailable.</Text> : <Text style={styles.summary}>{formatStorageSummary(billingSummaryQuery.data.storage.bytes, billingSummaryQuery.data.storage.estimatedMonthlyMicroSparks)}</Text>}
        </View>
        <View style={styles.section}>
          <View style={styles.titleRow}><Text style={styles.title}>AI usage</Text><SectionHelp label="What counts as AI usage?" onPress={() => onOpenHelp("ai")} /></View>
          {billingSummaryQuery.isPending ? <Skeleton style={styles.summarySkeleton} /> : billingSummaryQuery.isError ? <Text accessibilityRole="alert" style={styles.summary}>AI usage is unavailable.</Text> : <Text style={styles.summary}>{sparkLabel(formatSpentSparks(billingSummaryQuery.data.aiUsageMicroSparks))} spent</Text>}
        </View>
        <View style={styles.titleRow}><Text style={styles.title}>Action history</Text><SectionHelp label="What is action history?" onPress={() => onOpenHelp("actions")} /></View>
      </View>}
      onEndReached={loadMore}
      onEndReachedThreshold={0.4}
      renderItem={({ item }) => <View style={styles.row}><View style={styles.rowCopy}><Text style={styles.rowName}>{spendName(item.toolSlug, staticCharges)}</Text><Text style={styles.rowDate}>{formatSpendDate(item.createdAt)}</Text></View><Text style={styles.rowAmount}>{sparkLabel(formatSpentSparks(item.deltaMicroSparks))}</Text></View>}
      showsVerticalScrollIndicator={false}
      style={styles.list}
    />;
}

const styles = StyleSheet.create({
  list: { flex: 1 },
  content: { gap: spacing.lg, paddingBottom: spacing.lg, paddingHorizontal: spacing.xxs },
  header: { gap: spacing.xl },
  section: { gap: spacing.xs },
  titleRow: { alignItems: "center", flexDirection: "row", gap: spacing.xs },
  title: { color: palette.silver50, flex: 1, fontFamily: fonts.medium, fontSize: 16 },
  summary: { color: palette.silver500, fontFamily: fonts.regular, fontSize: 14, lineHeight: 20 },
  balance: { color: palette.chromeWhite, fontFamily: fonts.medium, fontSize: 20, lineHeight: 26 },
  summarySkeleton: { height: 20, width: "72%", backgroundColor: palette.hairlineBright, opacity: 0.72 },
  listSkeleton: { height: 48, width: "100%", backgroundColor: palette.hairlineBright, opacity: 0.72 },
  empty: { color: palette.silver500, fontFamily: fonts.regular, fontSize: 14, lineHeight: 20 },
  state: { alignItems: "center", gap: spacing.md },
  error: { color: palette.danger, fontFamily: fonts.regular, fontSize: 13, lineHeight: 19, textAlign: "center" },
  row: { alignItems: "flex-start", flexDirection: "row", gap: spacing.md, justifyContent: "space-between" },
  rowCopy: { flex: 1, gap: 3 },
  rowName: { color: palette.silver50, fontFamily: fonts.medium, fontSize: 14 },
  rowDate: { color: palette.silver500, fontFamily: fonts.regular, fontSize: 12, lineHeight: 17 },
  rowAmount: { color: palette.chromeWhite, fontFamily: fonts.medium, fontSize: 12, maxWidth: 110, textAlign: "right" },
});
