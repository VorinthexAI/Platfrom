import { randomUUID } from "expo-crypto";
import * as ImagePicker from "expo-image-picker";
import * as Haptics from "expo-haptics";
import { Image } from "expo-image";
import { useRouter } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { ScrollView, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ActionPill } from "@vorinthex/shared/ui/action-pill";
import { Avatar } from "@vorinthex/shared/ui/avatar";
import { BottomSheet, BottomSheetItem, BottomSheetMenu } from "@vorinthex/shared/ui/bottom-sheet";
import { Button } from "@vorinthex/shared/ui/button";
import { CheckIcon, ChevronDownIcon, ChevronUpIcon, FolderIcon, HelpIcon, LogOutIcon, PlusIcon, SettingsIcon } from "@vorinthex/shared/ui/icons-mobile";
import { Skeleton } from "@vorinthex/shared/ui/skeleton";
import { TextInput } from "@vorinthex/shared/ui/text-input";
import { useToast } from "@vorinthex/shared/ui/toast";

import { createFeedback, createSupportTicket, listFeedback, setFeedbackVote, updateProfileName, uploadProfileAvatar, type FeedbackItem } from "@/lib/profile-client";
import { profileInitial } from "@/lib/auth-helpers";
import { createScope, deleteScope, listScopes, prioritizeScope, scheduleScopeOperation, scopeListQueryKey, scopeOperationIsPending, selectScope, updateScopeCover, type ScopeSummary } from "@/lib/scope-client";
import { listTeams, queryBelongsToTeamScope, selectTeam, setPendingTeamMfa, teamListQueryKey } from "@/lib/team-client";
import { useAuthStore } from "@/state/auth";
import { extractDomainErrorMessage } from "@/lib/domain-error-observer";
import { fonts, palette, radii, spacing } from "@/theme/tokens";
import { AccountScreenShell } from "@/components/AccountScreenShell";
import { normalizeCapturedPng } from "@/lib/captured-image";
import { deleteGalleryImages, fetchGalleryUploadStatus, uploadGalleryImages, type GalleryContext } from "@/lib/gallery-client";

type ProfileSheet = "name" | "faq" | "report" | "feedback" | "feedback-create" | "delete-account" | "scope-help" | "scope-create" | "scope-actions" | "scope-delete" | "teams";

const FAQ = [
  ["What are Sparks?", "Sparks power AI actions across Vorinthex. Your balance is shared across every capability."],
  ["How do plan grants work?", "Weekly plans grant 200 Sparks each week. Monthly plans grant 1,000 Sparks each month when the billing period renews."],
  ["Do top-ups expire?", "A top-up adds 200 Sparks without changing your subscription. Product terms will be shown before purchases become available."],
  ["How do referral rewards work?", "You receive 50 Sparks once when a new user signs up with your code, then 100 more once when they first subscribe."],
  ["Can I cancel or renew?", "Subscription controls will show your status and renewal date. Cancellation stops future renewal; your current period remains available under the terms shown at purchase."],
  ["How do I restore renewal?", "If you scheduled cancellation for a Polar subscription, Restore renewal keeps that subscription renewing at the end of its current period."],
] as const;

const wait = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const canManageScope = (scope?: ScopeSummary) => scope?.role === "owner" || scope?.role === "admin";

function displayName(name?: string, email?: string) {
  return name?.trim() || email?.split("@")[0] || "Profile";
}

function ScopeCard({ onLongPress, onPress, scope, size }: { onLongPress?: () => void; onPress: () => void; scope?: ScopeSummary; size: number }) {
  return <View style={[styles.scopeCard, scope?.isCurrent && styles.scopeCardSelected, { height: size, width: size }]}>
    {scope?.coverUrl ? <Image contentFit="cover" source={scope.coverUrl} style={styles.scopeCover} /> : null}
    <Button accessibilityHint={onLongPress ? "Long press for scope actions" : undefined} accessibilityLabel={scope ? `${scope.isCurrent ? "Current scope" : "Select scope"}: ${scope.name}` : "Create scope"} contentMode="raw" delayLongPress={350} onLongPress={onLongPress} onPress={onPress} shape="rounded" size="md" style={[styles.scopeCardButton, scope?.coverUrl && styles.scopeCardButtonCovered]} variant="ghost">
      {scope ? <>{scope.coverUrl ? null : <FolderIcon size="lg" />}<Text numberOfLines={2} style={[styles.scopeCardLabel, scope.coverUrl && styles.scopeCardLabelCovered]}>{scope.name}</Text></> : <PlusIcon size="lg" />}
    </Button>
    {scope?.isCurrent ? <View pointerEvents="none" style={styles.scopeSelectedBadge}><CheckIcon size="sm" variant="inverse" /></View> : null}
  </View>;
}

export function AccountScreen({ page }: { page: "profile" | "settings" }) {
  const router = useRouter();
  const { width } = useWindowDimensions();
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const user = useAuthStore((state) => state.user);
  const teamKey = useAuthStore((state) => String(state.team?.key ?? ""));
  const teamSelectionEnabled = useAuthStore((state) => state.teamSelectionEnabled);
  const scopeKey = useAuthStore((state) => String(state.scope?.key ?? ""));
  const optimisticProfile = useAuthStore((state) => state.optimisticProfile);
  const optimisticScope = useAuthStore((state) => state.optimisticScope);
  const hydrate = useAuthStore((state) => state.hydrate);
  const signOut = useAuthStore((state) => state.signOut);
  const deleteAccount = useAuthStore((state) => state.deleteAccount);
  const [sheet, setSheet] = useState<ProfileSheet>();
  const [nameDraft, setNameDraft] = useState("");
  const [reportDraft, setReportDraft] = useState("");
  const [feedbackDraft, setFeedbackDraft] = useState("");
  const [submittingFeedback, setSubmittingFeedback] = useState(false);
  const [deletingAccount, setDeletingAccount] = useState(false);
  const [deleteError, setDeleteError] = useState("");
  const [scopeName, setScopeName] = useState("");
  const [scopeDescription, setScopeDescription] = useState("");
  const [votingKey, setVotingKey] = useState<string>();
  const [selectingTeam, setSelectingTeam] = useState(false);
  const [selectedScope, setSelectedScope] = useState<ScopeSummary>();
  const [deletingScope, setDeletingScope] = useState(false);
  const reportRequestKey = useRef<string | undefined>(undefined);
  const feedbackRequestKey = useRef<string | undefined>(undefined);
  const feedbackScrollRef = useRef<ScrollView>(null);
  const feedbackSyncKeys = useRef(new Set<string>());
  const scrollToNewFeedback = useRef(false);
  const longPressedScopeKey = useRef<string | undefined>(undefined);
  const scopeListMutation = useRef(0);
  const scopeManagementPending = useRef(false);
  const name = displayName(user?.name, user?.email);
  const feedbackQueryKey = ["profile-feedback", teamKey, scopeKey] as const;
  const scopeQueryKey = scopeListQueryKey(String(user?.key ?? ""), teamKey);
  const scopeCardSize = Math.floor((width - spacing.md * 2 - 20) / 3);
  const scopesQuery = useQuery({ queryKey: scopeQueryKey, queryFn: ({ signal }) => listScopes(teamKey, signal), enabled: Boolean(user?.key && teamKey), refetchOnMount: "always" });
  const teamsQuery = useQuery({ queryKey: teamListQueryKey(String(user?.key ?? "")), queryFn: ({ signal }) => listTeams(signal), enabled: teamSelectionEnabled && sheet === "teams" });
  const scopes = scopesQuery.data ?? [];
  const sortedScopes = [...scopes].sort((left, right) => left.position - right.position);
  const feedbackQuery = useQuery({
    queryKey: feedbackQueryKey,
    queryFn: async () => {
      const result = await listFeedback({ teamKey, scopeKey, limit: 50 });
      const serverKeys = new Set(result.items.map(({ key }) => key));
      for (const key of serverKeys) feedbackSyncKeys.current.delete(key);
      const pending = queryClient.getQueryData<Awaited<ReturnType<typeof listFeedback>>>(feedbackQueryKey)?.items.filter(({ key }) => (key.startsWith("optimistic:") || feedbackSyncKeys.current.has(key)) && !serverKeys.has(key)) ?? [];
      return { ...result, items: [...result.items, ...pending] };
    },
    enabled: false,
  });
  const refetchFeedback = feedbackQuery.refetch;

  useEffect(() => {
    if (sheet !== "feedback" || !teamKey || !scopeKey) return;
    void queryClient.invalidateQueries({ queryKey: ["profile-feedback", teamKey, scopeKey] }).then(() => refetchFeedback());
  }, [teamKey, queryClient, refetchFeedback, scopeKey, sheet]);

  useEffect(() => {
    if (sheet === "scope-create" && !scopeOperationIsPending()) void queryClient.invalidateQueries({ queryKey: scopeListQueryKey(String(user?.key ?? ""), teamKey) });
  }, [teamKey, queryClient, sheet, user?.key]);

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
    if (!message || !teamKey || !scopeKey) return;
    const requestKey = reportRequestKey.current ?? randomUUID();
    reportRequestKey.current = requestKey;
    setSheet(undefined);
    void createSupportTicket({ teamKey, scopeKey, message }, requestKey).then(() => {
      reportRequestKey.current = undefined;
      setReportDraft("");
      showToast({ title: "Issue report sent.", duration: 2_500 });
    }).catch(() => {
      setSheet("report");
      showToast({ title: "Your report could not be sent.", duration: 2_500 });
    });
  };

  const sendFeedback = () => {
    const message = feedbackDraft.trim();
    if (!message || !teamKey || !scopeKey) return;
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
    void createFeedback({ teamKey, scopeKey, message }, requestKey).then((created) => {
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
    if (votingKey || !teamKey || !scopeKey) return;
    const desiredVote = item.viewerVote === nextVote ? null : nextVote;
    setVotingKey(item.key);
    void setFeedbackVote({ teamKey, scopeKey, ticketKey: item.key, vote: desiredVote }, randomUUID()).then((updated) => {
      queryClient.setQueryData<Awaited<ReturnType<typeof listFeedback>>>(feedbackQueryKey, (current) => current ? { ...current, items: current.items.map((candidate) => candidate.key === updated.key ? updated : candidate) } : current);
    }).catch(() => {
      void queryClient.invalidateQueries({ queryKey: feedbackQueryKey }).then(() => feedbackQuery.refetch());
      showToast({ title: "Your vote could not be saved.", duration: 2_500 });
    }).finally(() => setVotingKey(undefined));
  };

  const permanentlyDeleteAccount = async () => {
    if (deletingAccount) return;
    setDeletingAccount(true);
    setDeleteError("");
    try {
      await deleteAccount();
      queryClient.clear();
      router.replace("/onboarding");
    } catch (error) {
      setDeleteError(extractDomainErrorMessage(error) ?? "Your account could not be deleted. Please try again.");
      setDeletingAccount(false);
    }
  };

  const logOut = async () => {
    setSheet(undefined);
    await signOut();
    queryClient.clear();
    router.replace("/auth");
  };

  const openScopeCreate = () => {
    setScopeName("");
    setScopeDescription("");
    setSheet("scope-create");
  };

  const markSelected = (items: ScopeSummary[], selected: ScopeSummary) => items.map((item) => item.key === selected.key
    ? { ...selected, isCurrent: true }
    : { ...item, isCurrent: false });

  const markCurrentKey = (items: ScopeSummary[], currentKey: string) => items.map((item) => ({ ...item, isCurrent: item.key === currentKey }));

  const resetScopeQueries = () => {
    void queryClient.cancelQueries({ predicate: ({ queryKey }) => queryKey[0] !== "scope-list" });
    queryClient.removeQueries({ predicate: ({ queryKey }) => queryKey[0] !== "scope-list" });
  };

  const chooseScope = (scope: ScopeSummary) => {
    if (scope.key.startsWith("optimistic:")) return;
    setSheet(undefined);
    if (scope.key === scopeKey) return;
    const previous = queryClient.getQueryData<ScopeSummary[]>(scopeQueryKey) ?? scopes;
    const update = optimisticScope({ ...scope, isCurrent: true });
    const optimisticList = markSelected(previous, scope);
    void queryClient.cancelQueries({ queryKey: scopeQueryKey }, { revert: false });
    queryClient.setQueryData(scopeQueryKey, optimisticList);
    resetScopeQueries();
    const operation = scheduleScopeOperation(() => selectScope(teamKey, scope.key));
    void operation.promise.then(async (selected) => {
      if (!operation.isCurrent()) return;
      await queryClient.cancelQueries({ queryKey: scopeQueryKey });
      if (!operation.isCurrent()) return;
      update.reconcile(selected);
      queryClient.setQueryData(scopeQueryKey, markSelected(optimisticList, selected));
    }).catch(async () => {
      if (!operation.isCurrent()) return;
      await queryClient.cancelQueries({ queryKey: scopeQueryKey });
      if (!operation.isCurrent()) return;
      update.rollback();
      await hydrate().catch(() => undefined);
      resetScopeQueries();
      const authoritativeKey = String(useAuthStore.getState().scope?.key ?? "");
      queryClient.setQueryData(scopeQueryKey, markCurrentKey(previous, authoritativeKey));
      if (authoritativeKey !== scope.key) showToast({ title: "Scope could not be switched.", duration: 2_500 });
    });
  };

  const submitScope = () => {
    const name = scopeName.trim();
    if (!name || !teamKey || scopeOperationIsPending()) return;
    const description = scopeDescription.trim();
    const requestKey = randomUUID();
    const previous = queryClient.getQueryData<ScopeSummary[]>(scopeQueryKey) ?? scopes;
    const optimisticKey = `optimistic:${requestKey}`;
    const optimisticCreated: ScopeSummary = { key: optimisticKey, slug: "pending", name, summary: description || `${name} workspace`, description: description || null, coverImageKey: null, coverUrl: null, position: 1, level: 1, role: "owner", isCurrent: true };
    void queryClient.cancelQueries({ queryKey: scopeQueryKey }, { revert: false });
    queryClient.setQueryData(scopeQueryKey, [optimisticCreated, ...previous.map((scope) => ({ ...scope, isCurrent: false }))]);
    const scopeUpdate = optimisticScope(optimisticCreated);
    setSheet(undefined);
    const operation = scheduleScopeOperation(async () => {
      const created = await createScope(teamKey, { name, ...(description ? { description } : {}) }, requestKey);
      if (!operation.isCurrent()) return { created };
      try {
        const selected = await selectScope(teamKey, created.key);
        return { created, selected };
      } catch {
        return { created, selectionFailed: true as const };
      }
    });
    void operation.promise.then(async ({ created, selected, selectionFailed }) => {
      if (!operation.isCurrent()) return;
      await queryClient.cancelQueries({ queryKey: scopeQueryKey });
      if (!operation.isCurrent()) return;
      resetScopeQueries();
      if (selected) {
        scopeUpdate.reconcile(selected);
        queryClient.setQueryData(scopeQueryKey, markSelected([selected, ...previous], selected));
      } else {
        scopeUpdate.rollback();
        await hydrate().catch(() => undefined);
        const authoritativeKey = String(useAuthStore.getState().scope?.key ?? "");
        queryClient.setQueryData(scopeQueryKey, markCurrentKey([created, ...previous], authoritativeKey));
        if (selectionFailed && authoritativeKey !== created.key) showToast({ title: "Scope was created, but could not be selected.", duration: 3_000 });
      }
    }).catch(async () => {
      if (!operation.isCurrent()) return;
      await queryClient.cancelQueries({ queryKey: scopeQueryKey });
      if (!operation.isCurrent()) return;
      scopeUpdate.rollback();
      await hydrate().catch(() => undefined);
      resetScopeQueries();
      queryClient.setQueryData(scopeQueryKey, previous);
      void queryClient.invalidateQueries({ queryKey: scopeQueryKey });
      showToast({ title: "Scope could not be created.", duration: 2_500 });
    });
  };

  const openScopeActions = (scope: ScopeSummary) => {
    if (scope.key.startsWith("optimistic:") || !canManageScope(scope) || scopeManagementPending.current) return;
    longPressedScopeKey.current = scope.key;
    setSelectedScope(scope);
    setSheet("scope-actions");
    void Haptics.selectionAsync();
  };

  const pressScope = (scope: ScopeSummary) => {
    if (longPressedScopeKey.current === scope.key) {
      longPressedScopeKey.current = undefined;
      return;
    }
    chooseScope(scope);
  };

  const prioritizeSelectedScope = () => {
    if (!selectedScope || !canManageScope(selectedScope) || scopeManagementPending.current) return;
    scopeManagementPending.current = true;
    const target = selectedScope;
    const previous = queryClient.getQueryData<ScopeSummary[]>(scopeQueryKey) ?? scopes;
    const prioritized = [target, ...previous.filter(({ key }) => key !== target.key)].map((scope, index) => ({ ...scope, position: index + 1 }));
    const mutation = ++scopeListMutation.current;
    setSheet(undefined);
    queryClient.setQueryData(scopeQueryKey, prioritized);
    void prioritizeScope(teamKey, target.key).then((updated) => {
      if (mutation !== scopeListMutation.current) return;
      queryClient.setQueryData<ScopeSummary[]>(scopeQueryKey, (current = prioritized) => current.map((scope) => scope.key === updated.key ? { ...scope, ...updated, position: 1 } : scope));
    }).catch((error) => {
      if (mutation !== scopeListMutation.current) return;
      queryClient.setQueryData(scopeQueryKey, previous);
      showToast({ title: extractDomainErrorMessage(error) ?? "Scope could not be prioritized.", duration: 2_500 });
    }).finally(() => { scopeManagementPending.current = false; });
  };

  const changeSelectedScopeCover = async () => {
    if (!selectedScope || !canManageScope(selectedScope) || scopeManagementPending.current) return;
    scopeManagementPending.current = true;
    const target = selectedScope;
    try {
      setSheet(undefined);
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) {
        showToast({ title: "Photo access is required to change the scope cover.", duration: 2_500 });
        return;
      }
      const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], allowsEditing: true, aspect: [1, 1], quality: 1 });
      if (result.canceled) return;
      const asset = result.assets[0];
      if (!asset?.uri || !asset.width || !asset.height) return;
      const previous = queryClient.getQueryData<ScopeSummary[]>(scopeQueryKey) ?? scopes;
      const mutation = ++scopeListMutation.current;
      queryClient.setQueryData<ScopeSummary[]>(scopeQueryKey, (current = previous) => current.map((scope) => scope.key === target.key ? { ...scope, coverUrl: asset.uri } : scope));
      const context: GalleryContext = { teamKey, scopeKey: target.key };
      let uploadedImageKey: string | undefined;
      let updateStarted = false;
      try {
        const normalized = await normalizeCapturedPng(asset, { maxSide: 2400, compress: 0.88 });
        const uploadKey = randomUUID();
        const upload = await uploadGalleryImages([{ clientKey: uploadKey, filename: `scope-cover-${uploadKey}.png`, uri: normalized.uri, sizeBytes: normalized.sizeBytes, processingMode: "cover" }], undefined, context);
        const job = upload.jobs[0];
        if (!job) throw new Error("The scope cover upload could not be started.");
        uploadedImageKey = job.imageKey;
        let status = job.status;
        for (let attempt = 0; status !== "completed" && status !== "failed" && attempt < 40; attempt += 1) {
          await wait(3_000);
          status = (await fetchGalleryUploadStatus([job.key], 60_000, context)).jobs[0]?.status ?? status;
        }
        if (status !== "completed") throw new Error("The scope cover could not be processed.");
        updateStarted = true;
        const updated = await updateScopeCover(teamKey, target.key, job.imageKey);
        if (mutation !== scopeListMutation.current) return;
        queryClient.setQueryData<ScopeSummary[]>(scopeQueryKey, (current = previous) => current.map((scope) => scope.key === target.key ? updated : scope));
        setSelectedScope(updated);
      } catch (error) {
        if (uploadedImageKey && !updateStarted) void deleteGalleryImages([uploadedImageKey], context).catch(() => undefined);
        if (mutation !== scopeListMutation.current) return;
        queryClient.setQueryData(scopeQueryKey, previous);
        showToast({ title: extractDomainErrorMessage(error) ?? "Scope cover could not be changed.", duration: 2_500 });
      }
    } finally {
      scopeManagementPending.current = false;
    }
  };

  const deleteSelectedScope = () => {
    if (!selectedScope || !canManageScope(selectedScope) || deletingScope || scopeManagementPending.current) return;
    const target = selectedScope;
    const previous = queryClient.getQueryData<ScopeSummary[]>(scopeQueryKey) ?? scopes;
    const fallback = previous.find(({ key }) => key !== target.key);
    if (!fallback) {
      showToast({ title: "The last scope cannot be deleted.", duration: 2_500 });
      return;
    }
    scopeManagementPending.current = true;
    const mutation = ++scopeListMutation.current;
    const scopeUpdate = target.isCurrent ? optimisticScope({ ...fallback, isCurrent: true }) : undefined;
    const optimisticList = previous.filter(({ key }) => key !== target.key).map((scope) => ({ ...scope, isCurrent: target.isCurrent ? scope.key === fallback.key : scope.isCurrent }));
    setDeletingScope(true);
    setSheet(undefined);
    queryClient.setQueryData(scopeQueryKey, optimisticList);
    void (async () => {
      const selected = target.isCurrent ? await selectScope(teamKey, fallback.key) : undefined;
      await deleteScope(teamKey, target.key);
      return selected;
    })().then((selected) => {
      if (mutation !== scopeListMutation.current) return;
      if (selected) scopeUpdate?.reconcile(selected);
      setSelectedScope(undefined);
    }).catch(async (error) => {
      if (mutation !== scopeListMutation.current) return;
      scopeUpdate?.rollback();
      if (target.isCurrent) await hydrate().catch(() => undefined);
      const authoritativeKey = String(useAuthStore.getState().scope?.key ?? "");
      queryClient.setQueryData(scopeQueryKey, target.isCurrent ? markCurrentKey(previous, authoritativeKey) : previous);
      resetScopeQueries();
      await queryClient.invalidateQueries({ queryKey: scopeQueryKey });
      showToast({ title: extractDomainErrorMessage(error) ?? "Scope could not be deleted.", duration: 3_000 });
    }).finally(() => {
      scopeManagementPending.current = false;
      setDeletingScope(false);
    });
  };

  const chooseTeamScope = async (targetTeamKey: string, targetScopeKey: string) => {
    if (selectingTeam) return;
    const previousTeamKey = teamKey;
    const previousScopeKey = scopeKey;
    setSelectingTeam(true);
    try {
      const result = await selectTeam(targetTeamKey, targetScopeKey);
      if (result.status !== "selected") {
        setPendingTeamMfa(result);
        setSheet(undefined);
        router.push("/auth/mfa");
        return;
      }
      await hydrate();
      await queryClient.cancelQueries({ predicate: ({ queryKey }) => queryBelongsToTeamScope(queryKey, previousTeamKey, previousScopeKey) });
      queryClient.removeQueries({ predicate: ({ queryKey }) => queryBelongsToTeamScope(queryKey, previousTeamKey, previousScopeKey) });
      setSheet(undefined);
    } catch {
      showToast({ title: "Team could not be switched.", duration: 2_500 });
    } finally { setSelectingTeam(false); }
  };

  const headerActions = <>
    <Button accessibilityLabel="Log out" contentMode="raw" iconOnly onPress={() => void logOut()} size="xs" variant="icon"><LogOutIcon size="sm" /></Button>
    {page === "profile" ? <Button accessibilityLabel="Open settings" contentMode="raw" iconOnly onPress={() => router.push("/settings")} size="xs" variant="icon"><SettingsIcon size="sm" /></Button> : null}
  </>;

  return <>
    <AccountScreenShell rightAction={headerActions} title={page === "profile" ? "Profile" : "Settings"}>
      {page === "profile" ? <View style={styles.content}>
        <Button accessibilityLabel="Change profile image" contentMode="raw" iconOnly onPress={() => void pickAvatar().catch(() => showToast({ title: "The image picker could not be opened.", duration: 2_500 }))} size="xl" style={styles.avatarButton} variant="ghost">
          <Avatar fallback={profileInitial(user)} size={104} style={styles.avatar} uri={user?.avatarUrl} />
        </Button>
        <Text style={styles.avatarHint}>Tap to change photo</Text>
        <View style={styles.identity}>
          <Button accessibilityLabel="Edit name" contentMode="raw" onPress={openName} size="xl" style={styles.nameButton} variant="ghost"><Text numberOfLines={2} style={styles.name}>{name}</Text></Button>
          {user?.email ? <Text style={styles.email}>{user.email}</Text> : null}
        </View>
        <View style={styles.scopeSection}>
          <View style={styles.scopeTitleRow}><Text style={styles.scopeTitle}>Scopes</Text><Button accessibilityLabel="What are scopes?" contentMode="raw" iconOnly onPress={() => setSheet("scope-help")} size="xs" variant="icon"><HelpIcon size="sm" /></Button></View>
          <View style={styles.scopeGrid}>
            <ScopeCard onPress={openScopeCreate} size={scopeCardSize} />
            {scopesQuery.isPending ? [0, 1].map((index) => <Skeleton key={index} style={[styles.scopeSkeleton, { height: scopeCardSize, width: scopeCardSize }]} />) : scopesQuery.isError && !scopes.length ? <View style={styles.scopeState}><Text accessibilityRole="alert" style={styles.deleteError}>Scopes could not be loaded.</Text><Button onPress={() => void scopesQuery.refetch()} size="md" variant="secondary">Retry</Button></View> : sortedScopes.map((scope) => <ScopeCard key={scope.key} onLongPress={canManageScope(scope) ? () => openScopeActions(scope) : undefined} onPress={() => pressScope(scope)} scope={scope} size={scopeCardSize} />)}
          </View>
        </View>
      </View> : <View style={styles.settingsContent}>
        <View style={styles.settingsMenu}>
          {teamSelectionEnabled ? <Button onPress={() => setSheet("teams")} size="md" variant="secondary">Switch team</Button> : null}
          <Button onPress={() => router.push("/notifications")} size="md" variant="secondary">Notifications</Button>
          <Button onPress={() => setSheet("feedback")} size="md" variant="secondary">Give feedback</Button>
          <Button onPress={() => setSheet("report")} size="md" variant="secondary">Report an issue</Button>
          <Button onPress={() => setSheet("faq")} size="md" variant="secondary">FAQ</Button>
          <Button onPress={() => { setDeleteError(""); setSheet("delete-account"); }} size="md" variant="danger">Delete account</Button>
        </View>
      </View>}
    </AccountScreenShell>

    <BottomSheet footer={<Button onPress={() => setSheet(undefined)} size="md" variant="secondary">Close</Button>} onOpenChange={(open) => { if (!open) setSheet(undefined); }} open={sheet === "scope-help"} title="Scopes">
      <Text style={styles.scopeHelp}>Scopes are separate workspaces for different parts of your life. For example, you can create one for work and another for personal use, keeping their content, conversations, and tools organized independently.</Text>
    </BottomSheet>

    <BottomSheet hideHeading onOpenChange={(open) => { if (!open) setSheet(undefined); }} open={sheet === "scope-actions" && canManageScope(selectedScope)} title="Scope actions">
      <BottomSheetMenu>
        <BottomSheetItem onPress={prioritizeSelectedScope}>Prioritize</BottomSheetItem>
        <BottomSheetItem onPress={() => void changeSelectedScopeCover()}>Change cover</BottomSheetItem>
        <BottomSheetItem onPress={() => setSheet("scope-delete")}>Delete</BottomSheetItem>
      </BottomSheetMenu>
    </BottomSheet>

    <BottomSheet dismissible={!deletingScope} footer={<><Button disabled={deletingScope} loading={deletingScope} onPress={deleteSelectedScope} size="md" variant="primary">Delete</Button><Button disabled={deletingScope} onPress={() => setSheet(undefined)} size="md" variant="secondary">Close</Button></>} onOpenChange={(open) => { if (!open && !deletingScope) setSheet(undefined); }} open={sheet === "scope-delete" && Boolean(selectedScope)} title="Delete scope">
      <Text style={styles.scopeHelp}>All data connected to this scope will be deleted. This action can&apos;t be undone.</Text>
    </BottomSheet>

    <BottomSheet focusKey="profile-scope-create" footer={<><Button disabled={!scopeName.trim()} onPress={submitScope} size="md" variant="primary">Create scope</Button><Button onPress={() => setSheet(undefined)} size="md" variant="secondary">Close</Button></>} height="full" onOpenChange={(open) => { if (!open) setSheet(undefined); }} open={sheet === "scope-create"} title="Create scope">
      <View style={styles.form}>
        <Text style={styles.inputLabel}>Scope name</Text>
        <TextInput accessibilityLabel="New scope name" maxLength={160} onChangeText={setScopeName} placeholder="Scope name" value={scopeName} />
        <Text style={styles.inputLabel}>Description (Optional)</Text>
        <TextInput accessibilityLabel="New scope description" maxLength={10_000} multiline onChangeText={setScopeDescription} placeholder="What belongs in this scope?" style={styles.reportInput} textAlignVertical="top" value={scopeDescription} />
      </View>
    </BottomSheet>

    <BottomSheet description="Choose an active team and scope." focusKey="profile-teams" footer={<Button disabled={selectingTeam} onPress={() => setSheet(undefined)} size="md" variant="secondary">Close</Button>} height="full" onOpenChange={(open) => { if (!open) setSheet(undefined); }} open={sheet === "teams"} title="Teams">
      <BottomSheetMenu>
        {teamsQuery.isPending ? <Text style={styles.scopeHelp}>Loading teams...</Text> : teamsQuery.isError ? <><Text accessibilityRole="alert" style={styles.deleteError}>Teams could not be loaded.</Text><Button onPress={() => void teamsQuery.refetch()} size="md" variant="secondary">Retry</Button></> : teamsQuery.data?.flatMap((team) => team.scopes.map((scope) => <BottomSheetItem disabled={selectingTeam} key={`${team.key}:${scope.key}`} onPress={() => void chooseTeamScope(team.key, scope.key)}>{team.name} / {scope.name}{team.key === teamKey && scope.key === scopeKey ? " (Current)" : ""}</BottomSheetItem>))}
      </BottomSheetMenu>
    </BottomSheet>

    <BottomSheet dismissible={!deletingAccount} focusKey="profile-delete-account" footer={<><Button disabled={deletingAccount} loading={deletingAccount} onPress={() => void permanentlyDeleteAccount()} size="md" variant="primary">Delete</Button><Button disabled={deletingAccount} onPress={() => setSheet(undefined)} size="md" variant="secondary">Close</Button></>} onOpenChange={(open) => { if (!open && !deletingAccount) setSheet(undefined); }} open={sheet === "delete-account"} title="Delete account?">
      {deleteError ? <Text accessibilityRole="alert" style={styles.deleteError}>{deleteError}</Text> : null}
    </BottomSheet>

    <BottomSheet description="Quick answers about plans and Sparks." focusKey="profile-faq" footer={<Button onPress={() => setSheet(undefined)} size="md" variant="secondary">Close</Button>} height="full" onOpenChange={(open) => { if (!open) setSheet(undefined); }} open={sheet === "faq"} title="FAQ">
      <ScrollView contentContainerStyle={styles.faqList}>{FAQ.map(([question, answer]) => <View key={question} style={styles.faqItem}><Text style={styles.faqQuestion}>{question}</Text><Text style={styles.faqAnswer}>{answer}</Text></View>)}</ScrollView>
    </BottomSheet>

    <BottomSheet focusKey="profile-name" footer={<><Button disabled={!nameDraft.trim()} onPress={saveName} size="md" variant="primary">Save</Button><Button onPress={() => setSheet(undefined)} size="md" variant="secondary">Close</Button></>} height="full" onOpenChange={(open) => { if (!open) setSheet(undefined); }} open={sheet === "name"} title="Edit name">
      <View style={styles.form}><Text style={styles.inputLabel}>Name</Text><TextInput accessibilityLabel="Name" maxLength={200} onChangeText={setNameDraft} onSubmitEditing={saveName} placeholder="Name" returnKeyType="done" value={nameDraft} /></View>
    </BottomSheet>

    <BottomSheet focusKey="profile-report" footer={<><Button disabled={!reportDraft.trim() || !teamKey || !scopeKey} onPress={sendReport} size="md" variant="primary">Send</Button><Button onPress={() => setSheet(undefined)} size="md" variant="secondary">Close</Button></>} height="full" onOpenChange={(open) => { if (!open) setSheet(undefined); }} open={sheet === "report"} title="Report an issue">
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

    <BottomSheet focusKey="profile-feedback-create" footer={<><Button disabled={!feedbackDraft.trim() || !teamKey || !scopeKey} onPress={sendFeedback} size="md" variant="primary">Send</Button><Button onPress={() => setSheet("feedback")} size="md" variant="secondary">Close</Button></>} height="full" onOpenChange={(open) => { if (!open) setSheet("feedback"); }} open={sheet === "feedback-create"} title="New feedback">
      <View style={styles.form}><Text style={styles.inputLabel}>Suggestion</Text><TextInput accessibilityLabel="Feedback suggestion" maxLength={8_000} multiline onChangeText={(value) => { feedbackRequestKey.current = undefined; setFeedbackDraft(value); }} placeholder="What would make Vorinthex AI better?" style={styles.reportInput} textAlignVertical="top" value={feedbackDraft} /></View>
    </BottomSheet>
  </>;
}

const styles = StyleSheet.create({
  content: { alignItems: "center", flexGrow: 1, paddingHorizontal: spacing.md, paddingTop: spacing.xl },
  settingsContent: { flexGrow: 1, paddingHorizontal: spacing.md, paddingTop: spacing.md },
  settingsMenu: { gap: spacing.sm },
  avatarButton: { height: 112, width: 112 },
  avatar: { backgroundColor: palette.voidBlack, borderColor: palette.hairlineBright, borderWidth: 1 },
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
  faqList: { gap: spacing.sm, paddingBottom: spacing.lg },
  faqItem: { borderBottomColor: palette.hairline, borderBottomWidth: 1, gap: spacing.xs, paddingBottom: spacing.md },
  faqQuestion: { color: palette.silver50, fontFamily: fonts.medium, fontSize: 16 },
  faqAnswer: { color: palette.silver500, fontFamily: fonts.regular, fontSize: 13, lineHeight: 20 },
  deleteError: { color: palette.danger, fontFamily: fonts.regular, fontSize: 13, lineHeight: 19 },
  scopeSection: { alignSelf: "stretch", gap: spacing.sm, marginTop: spacing.xl, width: "100%" },
  scopeTitleRow: { alignItems: "center", flexDirection: "row", justifyContent: "space-between", minHeight: 32 },
  scopeTitle: { color: palette.silver100, fontFamily: fonts.medium, fontSize: 16 },
  scopeHelp: { color: palette.silver300, fontFamily: fonts.regular, fontSize: 15, lineHeight: 23, paddingBottom: spacing.md },
  scopeGrid: { alignContent: "flex-start", flexDirection: "row", flexWrap: "wrap", gap: 10, width: "100%" },
  scopeCard: { backgroundColor: palette.panelRaised, borderColor: palette.hairline, borderRadius: radii.md, borderWidth: 1, overflow: "hidden", position: "relative" },
  scopeCardSelected: { borderColor: palette.silver50, elevation: 4, shadowColor: palette.silver50, shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.62, shadowRadius: 5 },
  scopeCardButton: { flexDirection: "column", gap: 10, height: "100%", paddingHorizontal: 8, width: "100%" },
  scopeCardButtonCovered: { backgroundColor: "rgba(0, 0, 0, 0.28)" },
  scopeCardLabel: { color: palette.silver100, fontFamily: fonts.medium, fontSize: 12, textAlign: "center", width: "100%" },
  scopeCardLabelCovered: { color: palette.chromeWhite, textShadowColor: "rgba(0, 0, 0, 0.9)", textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 4 },
  scopeCover: { bottom: 0, left: 0, position: "absolute", right: 0, top: 0 },
  scopeSelectedBadge: { alignItems: "center", backgroundColor: palette.silver50, borderRadius: 10, height: 20, justifyContent: "center", position: "absolute", right: 4, top: 4, width: 20 },
  scopeSkeleton: { backgroundColor: palette.hairlineBright, borderRadius: radii.md, opacity: 0.72 },
  scopeState: { alignItems: "center", gap: spacing.md, paddingVertical: spacing.xl, width: "100%" },
});
