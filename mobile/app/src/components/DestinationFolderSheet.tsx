import { useState } from "react";
import { ScrollView, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { BottomSheet } from "@vorinthex/shared/ui/bottom-sheet";
import { Button } from "@vorinthex/shared/ui/button";
import { FolderTile } from "@vorinthex/shared/ui/folder-tile";
import { Skeleton } from "@vorinthex/shared/ui/skeleton";
import type { ContentContext, ContentFolder } from "@/lib/content-client";
import { contentLocationQueryOptions } from "@/lib/content-query-cache";
import { fonts, palette, radii, spacing } from "@/theme/tokens";

export function DestinationFolderSheet({
  action,
  blockedFolderKeys,
  context,
  onClose,
  onConfirm,
  open,
  sourceStack,
  sourceFolderKey,
}: {
  action: "move" | "copy";
  blockedFolderKeys: readonly string[];
  context: ContentContext;
  onClose: () => void;
  onConfirm: (folder: ContentFolder | undefined, stack: ContentFolder[]) => void;
  open: boolean;
  sourceStack: ContentFolder[];
  sourceFolderKey?: string;
}) {
  const { width } = useWindowDimensions();
  const cardSize = Math.floor((width - 20 * 2 - 2 - 8 * 3) / 4);
  const [stack, setStack] = useState<ContentFolder[]>(sourceStack);
  const current = stack.at(-1);
  const locationQuery = useQuery({ ...contentLocationQueryOptions(context, current?.key), enabled: open });
  const folders = locationQuery.data?.folders ?? [];
  const origin = current?.key === sourceFolderKey;
  const insideSelection = stack.some(({ key }) => blockedFolderKeys.includes(key));
  const blocked = origin || insideSelection;

  return <BottomSheet
    description={blocked ? origin ? "The current folder is the origin. Choose another folder." : "This folder is inside the selection. Choose another folder." : `Choose where to ${action} the selected items.`}
    footer={<><Button disabled={blocked || locationQuery.isPending || locationQuery.isError} onPress={() => { const destination = current; const selectedStack = [...stack]; setStack(sourceStack); onConfirm(destination, selectedStack); }} size="md" variant="primary">{action === "move" ? "Move here" : "Copy here"}</Button><Button onPress={() => { setStack(sourceStack); onClose(); }} size="md" variant="secondary">Close</Button></>}
    height="full"
    onOpenChange={(next) => { if (!next) { setStack(sourceStack); onClose(); } }}
    open={open}
    title={action === "move" ? "Move to folder" : "Copy to folder"}
  >
    {locationQuery.isError ? <View style={styles.emptyState}><Text style={styles.empty}>Folders could not be loaded.</Text><Button onPress={() => void locationQuery.refetch()} size="md" variant="secondary">Retry</Button></View> : <ScrollView contentContainerStyle={styles.grid} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
      {locationQuery.isPending ? Array.from({ length: 4 }, (_, index) => <Skeleton key={index} style={[styles.card, styles.gridSkeleton, { width: cardSize, height: cardSize }]} />) : <>
       {current ? <FolderTile accessibilityLabel="Back to parent folder" label="Up" onPress={() => setStack((value) => value.slice(0, -1))} parent size={cardSize} /> : null}
       {folders.map((folder) => <FolderTile accessibilityLabel={`Open ${folder.name}`} key={folder.key} label={folder.name} onPress={() => setStack((value) => [...value, folder])} size={cardSize} />)}
      </>}
    </ScrollView>}
  </BottomSheet>;
}

const styles = StyleSheet.create({
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 8, paddingVertical: 4 },
  emptyState: { alignItems: "center", gap: spacing.sm },
  card: { borderRadius: radii.md, borderColor: palette.hairline, borderWidth: 1, backgroundColor: palette.panelRaised, overflow: "hidden" },
  gridSkeleton: { backgroundColor: palette.hairlineBright },
  empty: { paddingVertical: 24, width: "100%", color: palette.silver500, fontFamily: fonts.regular, textAlign: "center" },
});
