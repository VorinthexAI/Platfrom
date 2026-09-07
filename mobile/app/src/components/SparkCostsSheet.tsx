import { BottomSheet } from "@vorinthex/shared/ui/bottom-sheet";
import { Button } from "@vorinthex/shared/ui/button";
import { ScrollView, StyleSheet, Text, View } from "react-native";

import type { SparkCharge } from "@/lib/cost-client";
import { useAppsStore } from "@/state/apps";
import { fonts, palette, spacing } from "@/theme/tokens";

function chargePrice(charge: SparkCharge) {
  if (charge.kind === "variable") return "Usage based";
  if (charge.kind === "storage") return `${charge.sparkCost} Sparks per GB-month`;
  if (charge.unit === "new-email") return `${charge.sparkCost} Spark per new email`;
  if (charge.unit === "documents") return `${charge.sparkCost} Sparks per document`;
  if (charge.unit === "images") return `${charge.sparkCost} Sparks per image`;
  return `${charge.sparkCost} Sparks`;
}

export function SparkCostsSheet({ onOpenChange, open }: { onOpenChange: (open: boolean) => void; open: boolean }) {
  const charges = useAppsStore((state) => state.sparkCosts);
  const status = useAppsStore((state) => state.sparkCostsStatus);
  const refresh = useAppsStore((state) => state.refreshProducts);
  const close = () => onOpenChange(false);
  return <BottomSheet description="See which actions have predictable Spark prices." footer={<Button onPress={close} size="md" variant="secondary">Close</Button>} height="full" onDismissRequest={close} onOpenChange={onOpenChange} open={open} title="Spark costs">
    <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
      {status === "loading" || status === "idle" ? <Text style={styles.statusText}>Loading Spark costs...</Text> : status === "unavailable" ? <View style={styles.state}><Text accessibilityRole="alert" style={styles.error}>Spark costs could not be loaded.</Text><Button onPress={() => void refresh()} size="md" variant="secondary">Retry</Button></View> : <View style={styles.costList}>{charges.map((charge) => <View key={charge.key} style={styles.costRow}><View style={styles.costCopy}><Text style={styles.costName}>{charge.name}</Text><Text style={styles.costDescription}>{charge.description}</Text></View><Text style={styles.costPrice}>{chargePrice(charge)}</Text></View>)}</View>}
    </ScrollView>
  </BottomSheet>;
}

const styles = StyleSheet.create({
  content: { gap: spacing.lg, paddingBottom: spacing.lg },
  statusText: { color: palette.silver300, fontFamily: fonts.regular, fontSize: 14, lineHeight: 21 },
  costList: { gap: spacing.lg },
  costRow: { alignItems: "center", flexDirection: "row", gap: spacing.md, justifyContent: "space-between" },
  costCopy: { flex: 1, gap: 3 },
  costName: { color: palette.silver50, fontFamily: fonts.medium, fontSize: 14 },
  costDescription: { color: palette.silver500, fontFamily: fonts.regular, fontSize: 12, lineHeight: 17 },
  costPrice: { color: palette.chromeWhite, fontFamily: fonts.medium, fontSize: 12, maxWidth: 110, textAlign: "right" },
  state: { alignItems: "center", gap: spacing.md },
  error: { color: palette.danger, fontFamily: fonts.regular, fontSize: 13, lineHeight: 19, textAlign: "center" },
});
