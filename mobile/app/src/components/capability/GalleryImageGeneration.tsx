import { Image } from "expo-image";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { AiTextEditor } from "@vorinthex/shared/ui/ai-text-editor";
import { BottomSheet } from "@vorinthex/shared/ui/bottom-sheet";
import { Button, ButtonSizeProvider } from "@vorinthex/shared/ui/button";
import { CloseIcon, PlusIcon } from "@vorinthex/shared/ui/icons-mobile";
import { Tabs } from "@vorinthex/shared/ui/tabs";
import { useToast } from "@vorinthex/shared/ui/toast";

import { EmailAttachmentPicker, type EmailAttachmentImageUrls, type EmailAttachmentLabels } from "@/components/capability/EmailAttachmentPicker";
import { GalleryGenerationHistory } from "@/components/capability/GalleryGenerationHistory";
import type { EmailAttachmentRef } from "@/lib/email-client";
import { deleteGalleryGenerationHistory, listGalleryGenerationHistory, MAX_GALLERY_GENERATION_REFERENCES, type GalleryCollection, type GalleryGenerationHistoryItem, type GalleryGenerationInput } from "@/lib/gallery-client";
import { createGalleryGenerationRequestKey, galleryGenerationHistoryQueryKey, removeCachedGalleryGenerationHistory } from "@/lib/gallery-generation-cache";
import { getGalleryContext } from "@/lib/gallery-client";
import { useAuthStore } from "@/state/auth";
import { fonts, palette, spacing } from "@/theme/tokens";

type Props = {
  collection: GalleryCollection;
  onClose: () => void;
  onGenerate: (input: GalleryGenerationInput, requestKey: string) => void;
  open: boolean;
};

export function GalleryImageGeneration({ collection, onClose, onGenerate, open }: Props) {
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const context = getGalleryContext();
  const userKey = useAuthStore((state) => state.user?.key ?? "");
  const [count, setCount] = useState<1 | 2 | 3>(1);
  const [prompt, setPrompt] = useState("");
  const [references, setReferences] = useState<EmailAttachmentRef[]>([]);
  const [referenceLabels, setReferenceLabels] = useState<EmailAttachmentLabels>({});
  const [referenceImageUrls, setReferenceImageUrls] = useState<EmailAttachmentImageUrls>({});
  const [referenceGridWidth, setReferenceGridWidth] = useState(0);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [history, setHistory] = useState<GalleryGenerationHistoryItem[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState<string>();
  const [removingPrompt, setRemovingPrompt] = useState<string>();
  const historyRequest = useRef(0);

  useEffect(() => {
    if (open) return;
    historyRequest.current += 1;
    const timer = setTimeout(() => { setCount(1); setPrompt(""); setReferences([]); setReferenceLabels({}); setReferenceImageUrls({}); setPickerOpen(false); setHistoryOpen(false); }, 0);
    return () => clearTimeout(timer);
  }, [open]);

  async function openHistory() {
    const request = ++historyRequest.current;
    setHistory(queryClient.getQueryData(galleryGenerationHistoryQueryKey(context)) ?? []);
    setHistoryError(undefined);
    setHistoryLoading(true);
    setHistoryOpen(true);
    try {
      const loaded = await listGalleryGenerationHistory();
      if (request !== historyRequest.current) return;
      queryClient.setQueryData(galleryGenerationHistoryQueryKey(context), loaded);
      setHistory(loaded);
    } catch (error) {
      if (request === historyRequest.current) setHistoryError(error instanceof Error ? error.message : "Generation history could not be loaded.");
    } finally {
      if (request === historyRequest.current) setHistoryLoading(false);
    }
  }

  async function removeHistory(item: GalleryGenerationHistoryItem) {
    if (removingPrompt) return;
    const previous = removeCachedGalleryGenerationHistory(queryClient, context, item.normalizedPrompt);
    setHistory((current) => current.filter(({ normalizedPrompt }) => normalizedPrompt !== item.normalizedPrompt));
    setRemovingPrompt(item.normalizedPrompt);
    try {
      await deleteGalleryGenerationHistory(item.prompt);
    } catch {
      queryClient.setQueryData(galleryGenerationHistoryQueryKey(context), previous);
      setHistory(previous);
      setHistoryError("The generation prompt could not be removed.");
    } finally {
      setRemovingPrompt(undefined);
    }
  }

  function submit() {
    const value = prompt.trim();
    if (!value) return;
    const input = { collectionKey: collection.key, prompt: value, count, referenceImageKeys: references.map(({ key }) => key) };
    onClose();
    onGenerate(input, createGalleryGenerationRequestKey());
  }

  function removeAllReferences() {
    setReferences([]);
    setReferenceLabels({});
    setReferenceImageUrls({});
  }

  function finishReferenceSelection(selection: EmailAttachmentRef[], labels: EmailAttachmentLabels, imageUrls: EmailAttachmentImageUrls) {
    setReferences(selection.filter((reference) => reference.type === "image"));
    setReferenceLabels(labels);
    setReferenceImageUrls(imageUrls);
    setPickerOpen(false);
  }

  const referenceCardSize = Math.floor(((referenceGridWidth || 320) - 18) / 4);
  const footer = <><Button disabled={!prompt.trim()} onPress={submit} size="md" variant="primary">Generate</Button><Button onPress={onClose} size="md" variant="secondary">Close</Button></>;
  return <>
    <BottomSheet footer={footer} height="full" onOpenChange={(next) => { if (!next && !historyOpen && !pickerOpen) onClose(); }} open={open && !historyOpen && !pickerOpen} title="Generate images">
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        <Tabs accessibilityLabel="Number of images" accessibilityRole="tablist" style={styles.countTabs}>{([1, 2, 3] as const).map((value) => <Button accessibilityRole="tab" accessibilityState={{ selected: count === value }} key={value} onPress={() => setCount(value)} size="xs" style={styles.countTab} variant={count === value ? "secondary" : "ghost"}>{value}</Button>)}</Tabs>
        <AiTextEditor accessibilityLabel="Image generation prompt" maxLength={8_000} multiline onChangeText={setPrompt} onOpenHistory={() => void openHistory()} placeholder="Describe the image you want to create..." textAlignVertical="top" value={prompt} />
        <ButtonSizeProvider overrideParent size="xs">
          <View style={styles.contextActions}>
            <View style={styles.contextChip}>
              <Button accessibilityLabel="Open image generation context" contentMode="raw" onPress={() => setPickerOpen(true)} size="xs" style={styles.contextChipMain} variant="ghost"><Text style={styles.contextChipText}>Reference images</Text></Button>
              <Button accessibilityLabel="Add image generation context" contentMode="raw" hitSlop={10} iconOnly onPress={() => setPickerOpen(true)} shape="pill" size="xs" style={styles.contextChipAction} variant="secondary"><PlusIcon size="xs" /></Button>
            </View>
            {references.length ? <View style={styles.contextChip}>
              <Button contentMode="raw" onPress={removeAllReferences} size="xs" style={styles.contextChipMain} variant="ghost"><Text style={styles.contextChipText}>Remove all</Text></Button>
              <Button accessibilityLabel="Remove all image generation context" contentMode="raw" hitSlop={10} iconOnly onPress={removeAllReferences} shape="pill" size="xs" style={styles.contextChipAction} variant="secondary"><CloseIcon size="xs" /></Button>
            </View> : null}
          </View>
        </ButtonSizeProvider>
        {references.length ? <View accessibilityLabel={`${references.length} image generation reference images`} onLayout={({ nativeEvent }) => setReferenceGridWidth(nativeEvent.layout.width)} style={styles.contextGrid}>{references.map((reference) => { const identity = `image:${reference.key}`; const label = referenceLabels[identity] ?? "Reference image"; return <Button accessibilityLabel={`Edit context ${label}`} contentMode="raw" key={identity} onPress={() => setPickerOpen(true)} shape="rounded" size="md" style={[styles.contextCard, { width: referenceCardSize, height: referenceCardSize }]} variant="ghost"><Image accessibilityLabel={label} contentFit="cover" source={referenceImageUrls[identity]} style={styles.referenceImage} /></Button>; })}</View> : null}
      </ScrollView>
    </BottomSheet>
    <GalleryGenerationHistory error={historyError} history={history} loading={historyLoading} onClose={() => { historyRequest.current += 1; setHistoryOpen(false); }} onRemove={(item) => void removeHistory(item)} onSelect={(item) => { setPrompt(item.prompt); setHistoryOpen(false); }} open={open && historyOpen} removingPrompt={removingPrompt} />
    {pickerOpen && open ? <EmailAttachmentPicker context={{ ...context, userKey }} contextKey={`${context.organizationKey}:${context.scopeKey}:image-generation-context`} galleryOnly imageUrls={referenceImageUrls} labels={referenceLabels} maxSelection={MAX_GALLERY_GENERATION_REFERENCES} onClose={() => setPickerOpen(false)} onDone={finishReferenceSelection} onSelectionLimitReached={(limit) => showToast({ title: `You can select up to ${limit} images.`, duration: 2_500 })} open selection={references} title="Reference images" /> : null}
  </>;
}

const styles = StyleSheet.create({
  content: { gap: spacing.md, paddingBottom: spacing.xl },
  countTabs: { width: "100%", flexDirection: "row", padding: 3, borderWidth: 1, borderColor: palette.hairline },
  countTab: { flex: 1 },
  contextActions: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: spacing.xs },
  contextChip: { alignSelf: "flex-start", minHeight: 34, maxWidth: "100%", flexDirection: "row", alignItems: "center", gap: 6, borderWidth: 1, borderColor: "rgba(221, 226, 229, 0.18)", borderRadius: 999, backgroundColor: "rgba(255, 255, 255, 0.03)" },
  contextChipMain: { minWidth: 0, flexShrink: 1, justifyContent: "center", paddingLeft: 7, paddingRight: 0 },
  contextChipAction: { width: 24, minWidth: 24, maxWidth: 24, height: 24, minHeight: 24, maxHeight: 24, marginRight: 3, borderRadius: 12 },
  contextChipText: { minWidth: 0, flexShrink: 1, color: palette.silver100, fontFamily: fonts.medium, fontSize: 12, textAlign: "center" },
  contextGrid: { width: "100%", flexDirection: "row", flexWrap: "wrap", gap: 6 },
  contextCard: { position: "relative", overflow: "hidden", paddingHorizontal: 0, paddingVertical: 0, borderWidth: 1, borderColor: palette.hairline, backgroundColor: palette.panelRaised },
  referenceImage: { width: "100%", height: "100%" },
});
