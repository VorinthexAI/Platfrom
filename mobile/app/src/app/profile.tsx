import { randomUUID } from "expo-crypto";
import * as ImagePicker from "expo-image-picker";
import { useRouter } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ActionPill } from "@vorinthex/shared/ui/action-pill";
import { Avatar } from "@vorinthex/shared/ui/avatar";
import { BottomSheet } from "@vorinthex/shared/ui/bottom-sheet";
import { Button } from "@vorinthex/shared/ui/button";
import { ChevronDownIcon, ChevronUpIcon } from "@vorinthex/shared/ui/icons-mobile";
import { Skeleton } from "@vorinthex/shared/ui/skeleton";
import { TextInput } from "@vorinthex/shared/ui/text-input";
import { useToast } from "@vorinthex/shared/ui/toast";

import { createFeedback, createSupportTicket, listFeedback, setFeedbackVote, updateProfileName, uploadProfileAvatar, type FeedbackItem } from "@/lib/profile-client";
import { profileInitial } from "@/lib/auth-helpers";
import { useAuthStore } from "@/state/auth";
import { fonts, palette, spacing } from "@/theme/tokens";

type ProfileSheet = "name" | "report" | "feedback" | "feedback-create";

function displayName(name?: string, email?: string) {
  return name?.trim() || email?.split("@")[0] || "Profile";
}

export default function ProfileRoute() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const user = useAuthStore((state) => state.user);
  const organizationKey = useAuthStore((state) => String(state.organization?.key ?? ""));
  const scopeKey = useAuthStore((state) => String(state.scope?.key ?? ""));
  const optimisticProfile = useAuthStore((state) => state.optimisticProfile);
  const signOut = useAuthStore((state) => state.signOut);
  const [sheet, setSheet] = useState<ProfileSheet>();
  const [nameDraft, setNameDraft] = useState("");
  const [reportDraft, setReportDraft] = useState("");
  const [feedbackDraft, setFeedbackDraft] = useState("");
  const [submittingFeedback, setSubmittingFeedback] = useState(false);
  const [votingKey, setVotingKey] = useState<string>();
  const reportRequestKey = useRef<string | undefined>(undefined);
  const feedbackRequestKey = useRef<string | undefined>(undefined);
  const feedbackScrollRef = useRef<ScrollView>(null);
  const feedbackSyncKeys = useRef(new Set<string>());
  const scrollToNewFeedback = useRef(false);
  const name = displayName(user?.name, user?.email);
  const feedbackQueryKey = ["profile-feedback", organizationKey, scopeKey] as const;
  const feedbackQuery = useQuery({
    queryKey: feedbackQueryKey,
    queryFn: async () => {
      const result = await listFeedback({ organizationKey, scopeKey, limit: 50 });
      const serverKeys = new Set(result.items.map(({ key }) => key));
      for (const key of serverKeys) feedbackSyncKeys.current.delete(key);
      const pending = queryClient.getQueryData<Awaited<ReturnType<typeof listFeedback>>>(feedbackQueryKey)?.items.filter(({ key }) => (key.startsWith("optimistic:") || feedbackSyncKeys.current.has(key)) && !serverKeys.has(key)) ?? [];
      return { ...result, items: [...result.items, ...pending] };
    },
    enabled: false,
  });
  const refetchFeedback = feedbackQuery.refetch;

  useEffect(() => {
    if (sheet !== "feedback" || !organizationKey || !scopeKey) return;
    void queryClient.invalidateQueries({ queryKey: ["profile-feedback", organizationKey, scopeKey] }).then(() => refetchFeedback());
  }, [organizationKey, queryClient, refetchFeedback, scopeKey, sheet]);

  const pickAvatar = async () => {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      showToast({ title: "Photo access is required to update your profile image.", duration: 2_500 });
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], allowsEditing: true, aspect: [1, 1], quality: 0.9 });
    if (result.canceled) return;
    const asset = result.assets[0];
    if (!asset?.uri || !asset.fileSize) {
      showToast({ title: "The selected image could not be read.", duration: 2_500 });
      return;
    }
    const mimeType = asset.mimeType ?? "image/jpeg";
    if (mimeType !== "image/jpeg" && mimeType !== "image/png" && mimeType !== "image/webp") {
      showToast({ title: "Choose a JPEG, PNG, or WebP image.", duration: 2_500 });
      return;
    }
    const extension = mimeType === "image/png" ? "png" : mimeType === "image/webp" ? "webp" : "jpg";
    const filename = `profile-${Date.now()}.${extension}`;
    const update = optimisticProfile({ avatarUrl: asset.uri });
    void uploadProfileAvatar({ filename, mimeType, sizeBytes: asset.fileSize, uri: asset.uri }).then(update.reconcile).catch(() => {
      update.rollback();
      showToast({ title: "Profile image could not be updated.", duration: 2_500 });
    });
  };

  const openName = () => {
    setNameDraft(user?.name?.trim() ?? "");
    setSheet("name");
  };

  const saveName = () => {
    const nextName = nameDraft.trim();
    if (!nextName) return;
    setSheet(undefined);
    const update = optimisticProfile({ name: nextName });
    void updateProfileName(nextName).then(update.reconcile).catch(() => {
      update.rollback();
      showToast({ title: "Name could not be updated.", duration: 2_500 });
    });
  };

  const sendReport = () => {
    const message = reportDraft.trim();
    if (!message || !organizationKey || !scopeKey) return;
    const requestKey = reportRequestKey.current ?? randomUUID();
    reportRequestKey.current = requestKey;
    setReportDraft("");
    setSheet(undefined);
    void createSupportTicket({ organizationKey, scopeKey, message }, requestKey).then(() => {
      reportRequestKey.current = undefined;
      showToast({ title: "Issue report sent.", duration: 2_500 });
    }).catch(() => {
      setSheet("report");
      showToast({ title: "Your report could not be sent.", duration: 2_500 });
    });
  };

  const sendFeedback = () => {
    const message = feedbackDraft.trim();
    if (!message || !organizationKey || !scopeKey) return;
    const requestKey = feedbackRequestKey.current ?? randomUUID();
    feedbackRequestKey.current = requestKey;
    setFeedbackDraft("");
    const optimisticKey = `optimistic:${requestKey}`;
    const optimisticFeedback: FeedbackItem = { key: optimisticKey, message, upvotes: 0, downvotes: 0, viewerVote: null, createdAt: new Date().toISOString() };
    feedbackSyncKeys.current.add(optimisticKey);
    queryClient.setQueryData<Awaited<ReturnType<typeof listFeedback>>>(feedbackQueryKey, (current) => ({ items: [...(current?.items ?? []).filter(({ key }) => key !== optimisticKey), optimisticFeedback], nextCursor: current?.nextCursor ?? null }));
    scrollToNewFeedback.current = true;
    setSubmittingFeedback(true);
    setSheet("feedback");
    void createFeedback({ organizationKey, scopeKey, message }, requestKey).then((created) => {
      feedbackRequestKey.current = undefined;
      feedbackSyncKeys.current.delete(optimisticKey);
      feedbackSyncKeys.current.add(created.key);
      queryClient.setQueryData<Awaited<ReturnType<typeof listFeedback>>>(feedbackQueryKey, (current) => current ? { ...current, items: current.items.map((item) => item.key === optimisticKey ? created : item) } : { items: [created], nextCursor: null });
      showToast({ title: "Feedback sent. Thank you!", duration: 2_500 });
    }).catch(() => {
      feedbackSyncKeys.current.delete(optimisticKey);
      queryClient.setQueryData<Awaited<ReturnType<typeof listFeedback>>>(feedbackQueryKey, (current) => current ? { ...current, items: current.items.filter(({ key }) => key !== optimisticKey) } : current);
      showToast({ title: "Please send a clear feature request or product improvement.", duration: 3_000 });
    }).finally(() => setSubmittingFeedback(false));
  };

  const vote = (item: FeedbackItem, nextVote: "up" | "down") => {
    if (votingKey || !organizationKey || !scopeKey) return;
    const desiredVote = item.viewerVote === nextVote ? null : nextVote;
    setVotingKey(item.key);
    void setFeedbackVote({ organizationKey, scopeKey, ticketKey: item.key, vote: desiredVote }, randomUUID()).then((updated) => {
      queryClient.setQueryData<Awaited<ReturnType<typeof listFeedback>>>(feedbackQueryKey, (current) => current ? { ...current, items: current.items.map((candidate) => candidate.key === updated.key ? updated : candidate) } : current);
    }).catch(() => {
      void queryClient.invalidateQueries({ queryKey: feedbackQueryKey }).then(() => feedbackQuery.refetch());
      showToast({ title: "Your vote could not be saved.", duration: 2_500 });
    }).finally(() => setVotingKey(undefined));
  };

  return <View style={styles.root}>
    <BottomSheet footer={<><Button onPress={() => setSheet("feedback")} size="md" variant="secondary">Give us feedback</Button><Button onPress={() => setSheet("report")} size="md" variant="secondary">Report an issue</Button><Button onPress={() => void signOut()} size="md" variant="secondary">Log out</Button><Button onPress={() => router.back()} size="md" variant="secondary">Close</Button></>} height="full" onDismissRequest={() => router.back()} onOpenChange={() => undefined} open title="Profile">
      <ScrollView contentContainerStyle={styles.content}>
        <Button accessibilityLabel="Change profile image" contentMode="raw" iconOnly onPress={() => void pickAvatar().catch(() => showToast({ title: "The image picker could not be opened.", duration: 2_500 }))} size="xl" style={styles.avatarButton} variant="ghost">
          <Avatar fallback={profileInitial(user)} size={104} style={styles.avatar} uri={user?.avatarUrl} />
        </Button>
        <Text style={styles.avatarHint}>Tap to change photo</Text>
        <View style={styles.identity}>
          <Button accessibilityLabel="Edit name" contentMode="raw" onPress={openName} size="xl" style={styles.nameButton} variant="ghost"><Text numberOfLines={2} style={styles.name}>{name}</Text></Button>
          {user?.email ? <Text style={styles.email}>{user.email}</Text> : null}
        </View>
      </ScrollView>
    </BottomSheet>

    <BottomSheet focusKey="profile-name" footer={<><Button disabled={!nameDraft.trim()} onPress={saveName} size="md" variant="primary">Save</Button><Button onPress={() => setSheet(undefined)} size="md" variant="secondary">Close</Button></>} height="full" onOpenChange={(open) => { if (!open) setSheet(undefined); }} open={sheet === "name"} title="Edit name">
      <View style={styles.form}><Text style={styles.inputLabel}>Name</Text><TextInput accessibilityLabel="Name" maxLength={200} onChangeText={setNameDraft} onSubmitEditing={saveName} placeholder="Name" returnKeyType="done" value={nameDraft} /></View>
    </BottomSheet>

    <BottomSheet focusKey="profile-report" footer={<><Button disabled={!reportDraft.trim() || !organizationKey || !scopeKey} onPress={sendReport} size="md" variant="primary">Send</Button><Button onPress={() => setSheet(undefined)} size="md" variant="secondary">Close</Button></>} height="full" onOpenChange={(open) => { if (!open) setSheet(undefined); }} open={sheet === "report"} title="Report an issue">
      <View style={styles.form}><Text style={styles.inputLabel}>Issue description</Text><TextInput accessibilityLabel="Issue description" maxLength={8_000} multiline onChangeText={(value) => { reportRequestKey.current = undefined; setReportDraft(value); }} placeholder="What happened?" style={styles.reportInput} textAlignVertical="top" value={reportDraft} /></View>
    </BottomSheet>

    <BottomSheet description="Share an idea, or upvote and downvote suggestions from others." focusKey="profile-feedback" footer={<><Button disabled={submittingFeedback} onPress={() => setSheet("feedback-create")} size="md" variant="primary">New</Button><Button onPress={() => setSheet(undefined)} size="md" variant="secondary">Close</Button></>} height="full" onOpenChange={(open) => { if (!open) setSheet(undefined); }} open={sheet === "feedback"} title="Give us feedback">
      <ScrollView contentContainerStyle={styles.feedbackList} onContentSizeChange={() => { if (scrollToNewFeedback.current) { scrollToNewFeedback.current = false; requestAnimationFrame(() => feedbackScrollRef.current?.scrollToEnd({ animated: true })); } }} ref={feedbackScrollRef}>
        {feedbackQuery.isFetching && !feedbackQuery.data?.items.length ? [0, 1, 2].map((index) => <Skeleton key={index} style={styles.feedbackSkeleton} />) : feedbackQuery.isError && !feedbackQuery.data?.items.length ? <View style={styles.feedbackState}><Text style={styles.feedbackEmpty}>Feedback could not be loaded. Close and reopen this sheet to try again.</Text></View> : feedbackQuery.data?.items.length ? feedbackQuery.data.items.map((item) => {
          const upSelected = item.viewerVote === "up";
          const downSelected = item.viewerVote === "down";
          return <ActionPill
            action={<View style={styles.voteContent}><ChevronUpIcon size="sm" variant={upSelected ? "inverse" : "muted"} /><Text style={[styles.voteCount, upSelected && styles.voteCountSelected]}>{item.upvotes}</Text></View>}
            actionLabel={`Upvote: ${item.message}`}
            actionSelected={upSelected}
            appearance="reorder"
            disabled={votingKey === item.key || item.key.startsWith("optimistic:")}
            key={item.key}
            onAction={() => vote(item, "up")}
            onSecondaryAction={() => vote(item, "down")}
            secondaryAction={<View style={styles.voteContent}><ChevronDownIcon size="sm" variant={downSelected ? "inverse" : "muted"} /><Text style={[styles.voteCount, downSelected && styles.voteCountSelected]}>{item.downvotes}</Text></View>}
            secondaryActionLabel={`Downvote: ${item.message}`}
            secondaryActionSelected={downSelected}
          ><Text numberOfLines={1} style={styles.feedbackMessage}>{item.message}</Text></ActionPill>;
        }) : <View style={styles.feedbackState}><Text style={styles.feedbackEmpty}>No suggestions yet. Be the first to share one.</Text></View>}
      </ScrollView>
    </BottomSheet>

    <BottomSheet focusKey="profile-feedback-create" footer={<><Button disabled={!feedbackDraft.trim() || !organizationKey || !scopeKey} onPress={sendFeedback} size="md" variant="primary">Send</Button><Button onPress={() => setSheet("feedback")} size="md" variant="secondary">Close</Button></>} height="full" onOpenChange={(open) => { if (!open) setSheet("feedback"); }} open={sheet === "feedback-create"} title="New feedback">
      <View style={styles.form}><Text style={styles.inputLabel}>Suggestion</Text><TextInput accessibilityLabel="Feedback suggestion" maxLength={8_000} multiline onChangeText={(value) => { feedbackRequestKey.current = undefined; setFeedbackDraft(value); }} placeholder="What would make Vorinthex AI better?" style={styles.reportInput} textAlignVertical="top" value={feedbackDraft} /></View>
    </BottomSheet>
  </View>;
}

const styles = StyleSheet.create({
  root: { backgroundColor: palette.page, flex: 1 },
  content: { alignItems: "center", flexGrow: 1, paddingHorizontal: spacing.lg, paddingTop: spacing.xl },
  avatarButton: { height: 112, width: 112 },
  avatar: { borderColor: palette.hairlineBright, borderWidth: 1 },
  avatarHint: { color: palette.silver500, fontFamily: fonts.regular, fontSize: 12, marginTop: spacing.xs },
  identity: { alignItems: "center", gap: spacing.xs, marginTop: spacing.md },
  nameButton: { maxWidth: "100%", paddingHorizontal: spacing.sm },
  name: { color: palette.silver50, flexShrink: 1, fontFamily: fonts.medium, fontSize: 28, lineHeight: 34, textAlign: "center" },
  email: { color: palette.silver500, fontFamily: fonts.regular, fontSize: 14 },
  form: { gap: spacing.sm },
  feedbackList: { flexGrow: 1, gap: spacing.sm, paddingBottom: spacing.md },
  feedbackSkeleton: { borderRadius: 999, height: 48, width: "100%" },
  feedbackMessage: { color: palette.silver100, flexShrink: 1, fontFamily: fonts.regular, fontSize: 14 },
  feedbackEmpty: { color: palette.silver500, fontFamily: fonts.regular, fontSize: 14, lineHeight: 20, paddingHorizontal: spacing.sm, textAlign: "center" },
  feedbackState: { alignItems: "center", flex: 1, justifyContent: "center" },
  inputLabel: { color: palette.silver300, fontFamily: fonts.medium, fontSize: 12, letterSpacing: 0.4, marginLeft: 2 },
  reportInput: { minHeight: 180 },
  voteContent: { alignItems: "center", flexDirection: "row", gap: 2 },
  voteCount: { color: palette.silver500, fontFamily: fonts.medium, fontSize: 10 },
  voteCountSelected: { color: palette.obsidian900 },
});
