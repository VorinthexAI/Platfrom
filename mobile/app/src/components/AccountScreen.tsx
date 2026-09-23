import { randomUUID } from "expo-crypto";
import * as ImagePicker from "expo-image-picker";
import * as Haptics from "expo-haptics";
import { Image } from "expo-image";
import { useRouter } from "expo-router";
import { useEffect, useRef, useState, type ComponentRef, type ReactNode } from "react";
import { ScrollView, Share as NativeShare, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Avatar } from "@vorinthex/shared/ui/avatar";
import { BottomSheet, BottomSheetItem, BottomSheetMenu } from "@vorinthex/shared/ui/bottom-sheet";
import { Button } from "@vorinthex/shared/ui/button";
import { BellIcon, CheckIcon, DeleteAccountIcon, FaqIcon, FeedbackIcon, FolderIcon, HelpIcon, IssueIcon, PlusIcon, PrivacyIcon, ReferralIcon, SettingsIcon, SignOutIcon, SparksIcon, SubscriptionCancelIcon, TermsIcon, WalletIcon } from "@vorinthex/shared/ui/icons-mobile";
import { Skeleton } from "@vorinthex/shared/ui/skeleton";
import { Tabs } from "@vorinthex/shared/ui/tabs";
import { TextInput } from "@vorinthex/shared/ui/text-input";
import { useToast as useRawToast } from "@vorinthex/shared/ui/toast";
import { useSessionToast as useToast } from "@/hooks/use-session-toast";
import { PRIVACY_COPY, TERMS_COPY, type VaultCopy } from "@vorinthex/shared/lib/legal-copy";

import { claimProfileBadge, generateProfileBadge, updateProfileName, uploadProfileAvatar } from "@/lib/profile-client";
import { profileInitial } from "@/lib/auth-helpers";
import { createScope, deleteScope, listScopes, prioritizeScope, scheduleScopeOperation, scopeListQueryKey, scopeOperationIsPending, selectScope, updateScopeCover, type ScopeSummary } from "@/lib/scope-client";
import { useAuthStore } from "@/state/auth";
import { useAppsStore } from "@/state/apps";
import { extractDomainErrorMessage, isSparkFundingError } from "@/lib/domain-error-observer";
import { fonts, palette, radii, spacing } from "@/theme/tokens";
import { AccountScreenShell } from "@/components/AccountScreenShell";
import { WalletSheet, type WalletHelp } from "@/components/WalletSheet";
import { normalizeCapturedPng } from "@/lib/captured-image";
import { deleteGalleryImages, fetchGalleryUploadStatus, uploadGalleryImages, type GalleryContext } from "@/lib/gallery-client";
import { currentSubscriptionQueryKey, setSubscriptionCancellation, wholeSparks } from "@/lib/billing-client";
import { useBillingSummary, useCurrentSubscription } from "@/hooks/use-billing-summary";
import { fetchReferralSummary, normalizeReferralCode, redeemReferralCode, referralCodeSchema, referralRedemptionErrorMessage, referralSummaryQueryKey, type ReferralRedeemResult } from "@/lib/referral-client";
import { subscriptionPresentation } from "@/lib/subscription-presentation";
import { useUiStore } from "@/state/ui";

type ProfileSheet = "avatar-actions" | "badge-generate" | "name" | "faq" | "privacy" | "terms" | "cancel-subscription" | "delete-account" | "referral" | "wallet" | "scope-help" | "scope-create" | "scope-actions" | "scope-delete";
type ReferralMode = "share" | "redeem";
export type AccountScreenInitialState = { sheet: "referral"; referralMode: ReferralMode };

const FAQ = [
  ["What is Vorinthex AI, and where should I start?", "Vorinthex AI is one connected workspace for knowledge, images, communication, travel, learning, and conversation. Start in Core with a question, or open the focused app that matches what you want to do."],
  ["What can Core help me do?", "Core can answer general questions, discuss ideas, and search the workspace information available to your request. It can take you to matching items in their apps, while app-specific controls keep changes deliberate."],
  ["How do Core, Archive, Gallery, Signal, Compass, and Ascend work together?", "Each app has a focused purpose but shares your account and authorized workspace context. Core can surface connected results, and the focused apps remain where you organize content and control actions."],
  ["What should I save and organize in Archive?", "Use Archive for notes, documents, uploaded files, research, plans, references, project material, and ideas you may want to find again. Folders, tags, editing, and semantic search keep that knowledge useful."],
  ["How can I find something without remembering its title or filename?", "Search with the subject, meaning, people, place, or details you remember. Semantic search can find relevant authorized documents, images, messages, places, trips, and audio books without requiring an exact title."],
  ["Where are my Core chats saved?", "Core chats are organized automatically in Archive under Vorinthex AI / Core / Chats. Rolling summaries support continuity, and processed chat content can later be found by meaning within its private authorized scope."],
  ["What can I organize and search for in Gallery?", "Gallery keeps uploaded pictures, generated images, collections, memories, and highlights together. You can use collections, covers, favorites, tags, visible content, and available place information to organize and rediscover images."],
  ["How do Gallery collections, memories, and highlights work?", "Collections group related images around an idea, place, project, event, or story. Memories create a written reflection around an image, while highlights turn a selected or random set of collection images into a visual sequence."],
  ["Can Core help me find images, documents, messages, trips, and books?", "Yes. Core can search authorized information across the connected apps and show matching results. Selecting a result opens the responsible app so you can review it and use that app's controls."],
  ["How does Signal work with my connected email?", "Signal brings connected email together with communication from Vorinthex AI apps and support in one private inbox. You can synchronize conversations, search by meaning, review threads, and prepare replies."],
  ["Will Signal ever send an email without my approval?", "No. You choose connected accounts, review generated drafts, and explicitly decide what is sent. Core may help you find communication, but Signal remains responsible for email actions and keeps their controls visible."],
  ["Where can I open and organize attachments from Signal?", "Supported attachments can open in Archive or Gallery, depending on their type. This lets documents and images remain useful in their focused workspace instead of staying buried in an email thread."],
  ["What can I explore, save, and plan in Compass?", "Compass lets you explore countries and cities, save places you want to visit, record places you have visited, and arrange destinations into trips. You can begin with curiosity and build a structured plan gradually."],
  ["Can I connect Archive folders and Gallery collections to a trip?", "Yes. Compass can keep relevant Archive folders and Gallery collections attached to a trip, so research, documents, and images remain close to the journey they support."],
  ["How does Ascend create a personalized audio book?", "You choose a topic, learning goal, current knowledge, tone, narrator, and pace. Ascend reviews the brief, then builds the cover, chapters, and narration in the background for reading and listening."],
  ["Can Ascend use my Archive documents as source material?", "Yes. You can select Archive documents when you want an audio book grounded in material you already trust. Ascend keeps the resulting chapters, narration, cover, and listening progress together."],
  ["How do scopes and permissions keep my information private?", "Scopes keep workspace context separated, and connected searches only use information authorized for the current request. You decide what to save, connect, edit, move, send, or delete in each app."],
  ["What are Sparks, and what uses them?", "Sparks are your shared prepaid balance for AI capabilities, stored work, and connected services across Vorinthex AI. Some actions have a fixed Spark cost while other AI usage varies; current charge categories appear on the Sparks screen."],
  ["How do weekly plans, monthly plans, and top-ups work?", "The weekly plan grants 200 Sparks each week for $7.99. The launch monthly plan grants 1,000 Sparks each month for $19.99. A $9.99 top-up adds 200 Sparks without changing your subscription; applicable taxes are added at checkout."],
  ["What happens to my Sparks and stored work if I cancel or run out of Sparks?", "Canceling stops renewal after the current period, and prepaid Sparks remain available. Unfunded storage creates no debt or backcharges, but stored data is permanently deleted after 90 consecutive unfunded days. Adding enough Sparks before deletion begins restores prospective charging."],
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
      {scope ? <>{scope.coverUrl ? null : <FolderIcon size="lg" />}<Text ellipsizeMode="tail" numberOfLines={1} style={[styles.scopeCardLabel, scope.coverUrl && styles.scopeCardLabelCovered]}>{scope.name}</Text></> : <PlusIcon size="lg" />}
    </Button>
    {scope?.isCurrent ? <View pointerEvents="none" style={styles.scopeSelectedBadge}><CheckIcon size="sm" variant="inverse" /></View> : null}
  </View>;
}

function SettingsActionCard({ danger = false, icon, label, onPress, size }: { danger?: boolean; icon: ReactNode; label: string; onPress: () => void; size: number }) {
  return <View style={[styles.settingsCard, { height: size, width: size }]}>
    <Button accessibilityLabel={label} contentMode="raw" onPress={onPress} shape="rounded" size="xl" style={styles.settingsCardButton} variant="ghost">
      {icon}
      <Text numberOfLines={2} style={[styles.settingsCardLabel, danger && styles.settingsCardLabelDanger]}>{label}</Text>
    </Button>
  </View>;
}

function LegalSheetContent({ copy }: { copy: VaultCopy }) {
  return <ScrollView contentContainerStyle={styles.legalContent} showsVerticalScrollIndicator={false}>
    {copy.paragraphs.map((paragraph, index) => <Text key={`intro-${index}`} style={styles.legalParagraph}>{paragraph}</Text>)}
    {copy.sections?.map((section) => <View key={section.title} style={styles.legalSection}>
      <Text style={styles.legalParagraph}>{section.title}</Text>
      {section.paragraphs.map((paragraph, index) => <Text key={`${section.title}-${index}`} style={styles.legalParagraph}>{paragraph}</Text>)}
    </View>)}
    <Text style={styles.legalFootnote}>{copy.footnote}</Text>
  </ScrollView>;
}

export function AccountScreen({ initialState, onReferralSheetClose, page }: { initialState?: AccountScreenInitialState; onReferralSheetClose?: () => void; page: "profile" | "settings" }) {
  const router = useRouter();
  const { width } = useWindowDimensions();
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const { showToast: showAccountResultToast } = useRawToast();
  const deletingAccount = useRef(false);
  const [accountDeletionPending, setAccountDeletionPending] = useState(false);
  const user = useAuthStore((state) => state.user);
  const teamKey = useAuthStore((state) => String(state.team?.key ?? ""));
  const scopeKey = useAuthStore((state) => String(state.scope?.key ?? ""));
  const authReferralSummary = useAuthStore((state) => state.referralSummary);
  const optimisticProfile = useAuthStore((state) => state.optimisticProfile);
  const optimisticScope = useAuthStore((state) => state.optimisticScope);
  const hydrate = useAuthStore((state) => state.hydrate);
  const signOut = useAuthStore((state) => state.signOut);
  const deleteAccount = useAuthStore((state) => state.deleteAccount);
  const openCostDetails = useUiStore((state) => state.openCostDetails);
  const openPaywall = useUiStore((state) => state.openPaywall);
  const products = useAppsStore((state) => state.products);
  const badgeCost = useAppsStore((state) => state.capabilityCosts["profile.badge.generate"]);
  const refreshProducts = useAppsStore((state) => state.refreshProducts);
  const [sheet, setSheet] = useState<ProfileSheet | undefined>(initialState?.sheet);
  const [walletHelp, setWalletHelp] = useState<WalletHelp>();
  const [nameDraft, setNameDraft] = useState("");
  const [scopeName, setScopeName] = useState("");
  const [scopeDescription, setScopeDescription] = useState("");
  const [faqQuestionIndex, setFaqQuestionIndex] = useState<number>();
  const [generatingBadge, setGeneratingBadge] = useState(false);
  const [selectedScope, setSelectedScope] = useState<ScopeSummary>();
  const [deletingScope, setDeletingScope] = useState(false);
  const [sharingReferral, setSharingReferral] = useState(false);
  const [referralMode, setReferralMode] = useState<ReferralMode>(initialState?.referralMode ?? "share");
  const [referralCode, setReferralCode] = useState("");
  const [referralRedemption, setReferralRedemption] = useState<ReferralRedeemResult>();
  const [referralRedemptionError, setReferralRedemptionError] = useState("");
  const [redeemingReferral, setRedeemingReferral] = useState(false);
  const referralCodeInputRef = useRef<ComponentRef<typeof TextInput>>(null);
  const longPressedScopeKey = useRef<string | undefined>(undefined);
  const scopeListMutation = useRef(0);
  const scopeManagementPending = useRef(false);
  const name = displayName(user?.name, user?.email);
  const scopeQueryKey = scopeListQueryKey(String(user?.key ?? ""), teamKey);
  const scopeCardSize = Math.floor((width - spacing.md * 2 - 20) / 3);
  const settingsCardSize = scopeCardSize;
  const billingSummaryQuery = useBillingSummary(user?.key);
  const subscriptionQuery = useCurrentSubscription(page === "settings" ? user?.key : undefined);
  const referralQuery = useQuery({ queryKey: referralSummaryQueryKey(String(user?.key ?? "")), queryFn: fetchReferralSummary, enabled: Boolean(user?.key && sheet === "referral"), initialData: authReferralSummary?.code.ownerUserKey === user?.key ? authReferralSummary : undefined });
  const scopesQuery = useQuery({ queryKey: scopeQueryKey, queryFn: ({ signal }) => listScopes(teamKey, signal), enabled: Boolean(user?.key && teamKey), refetchOnMount: "always" });
  const scopes = scopesQuery.data ?? [];
  const sortedScopes = [...scopes].sort((left, right) => left.position - right.position);
  const selectedFaq = faqQuestionIndex === undefined ? undefined : FAQ[faqQuestionIndex];
  const canDeleteSelectedScope = Boolean(selectedScope && scopes.some((scope) => scope.key !== selectedScope.key && !scope.key.startsWith("optimistic:")));
  const referralUnused = Boolean(referralQuery.data && referralQuery.data.attributionCount === 0);
  const normalizedReferralCode = normalizeReferralCode(referralCode);
  const referralCodeValid = referralCodeSchema.safeParse(normalizedReferralCode).success;
  const subscription = subscriptionQuery.data;
  const subscriptionProduct = subscription ? products.find(({ key }) => key === subscription.productKey) : undefined;
  const subscriptionView = subscription ? subscriptionPresentation(subscription, subscriptionProduct) : undefined;
  const cancellationPeriodEnd = subscription?.currentPeriodEnd ? new Date(subscription.currentPeriodEnd).toLocaleDateString() : undefined;
  const cancelSubscription = useMutation({
    mutationFn: () => setSubscriptionCancellation(true),
    onSuccess: (updated) => {
      if (user?.key) {
        const queryKey = currentSubscriptionQueryKey(user.key);
        queryClient.setQueryData(queryKey, updated);
        void queryClient.invalidateQueries({ queryKey, exact: true, refetchType: "active" });
      }
    },
    onError: () => showToast({ title: "Subscription could not be canceled. Please try again.", duration: 2_500 }),
  });
  const confirmSubscriptionCancellation = () => {
    if (cancelSubscription.isPending) return;
    setSheet(undefined);
    showToast({ title: "Subscription cancelled", duration: 2_500 });
    cancelSubscription.mutate();
  };
  useEffect(() => {
    if (sheet === "scope-create" && !scopeOperationIsPending()) void queryClient.invalidateQueries({ queryKey: scopeListQueryKey(String(user?.key ?? ""), teamKey) });
  }, [teamKey, queryClient, sheet, user?.key]);
  const initialReferralMode = initialState?.referralMode;
  const initialSheet = initialState?.sheet;
  useEffect(() => {
    if (!initialSheet || !initialReferralMode) return;
    const timeout = setTimeout(() => {
      setReferralMode(initialReferralMode);
      setSheet(initialSheet);
    }, 0);
    return () => clearTimeout(timeout);
  }, [initialReferralMode, initialSheet]);
  useEffect(() => {
    if (sheet !== "referral" || referralMode !== "redeem") return;
    const timeout = setTimeout(() => referralCodeInputRef.current?.focus(), 300);
    return () => clearTimeout(timeout);
  }, [referralMode, sheet]);

  const pickAvatar = async () => {
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

  const generateBadge = async () => {
    if (!teamKey || !scopeKey || !badgeCost || generatingBadge) return;
    setSheet(undefined);
    setGeneratingBadge(true);
    try {
      const candidate = await generateProfileBadge(teamKey, scopeKey, randomUUID());
      const update = optimisticProfile({ avatarUrl: candidate.avatarUrl });
      try {
        const profile = await claimProfileBadge(teamKey, scopeKey, candidate.candidateKey);
        update.reconcile(profile.avatarUrl ? profile : { avatarUrl: candidate.avatarUrl });
      } catch (error) {
        update.rollback();
        throw error;
      }
    } catch (error) {
      if (!isSparkFundingError(error)) showToast({ title: extractDomainErrorMessage(error) ?? "Your profile badge could not be generated. Please try again.", duration: 2_500 });
    } finally {
      setGeneratingBadge(false);
    }
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

  const permanentlyDeleteAccount = () => {
    if (deletingAccount.current) return;
    const owner = useAuthStore.getState().user?.key;
    deletingAccount.current = true;
    setAccountDeletionPending(true);
    void deleteAccount().then(() => {
      if (useAuthStore.getState().status !== "unauthenticated") return;
      setSheet(undefined);
      queryClient.clear();
      router.replace("/auth");
      showAccountResultToast({ title: "Your account has been deleted.", duration: 3_000 });
    }).catch(() => {
      if (useAuthStore.getState().user?.key !== owner) return;
      showAccountResultToast({ title: "Your account could not be deleted. Please try again.", duration: 3_000 });
      void queryClient.invalidateQueries();
    }).finally(() => { deletingAccount.current = false; setAccountDeletionPending(false); });
  };

  const logOut = () => {
    setSheet(undefined);
    const cleanup = signOut();
    queryClient.clear();
    router.replace("/auth");
    void cleanup.catch(() => undefined);
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
    const fallback = previous.find(({ key }) => key !== target.key && !key.startsWith("optimistic:"));
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

  const headerActions = page === "profile" ? <>
    <Button accessibilityLabel="Open notifications in Signal" contentMode="raw" iconOnly onPress={() => router.push({ pathname: "/capability/[slug]", params: { slug: "signal", tab: "unread", inbox: "internal" } })} size="xs" variant="icon"><BellIcon size="sm" /></Button>
    <Button accessibilityLabel="Open settings" contentMode="raw" iconOnly onPress={() => router.push("/settings")} size="xs" variant="icon"><SettingsIcon size="sm" /></Button>
  </> : undefined;

  async function shareReferral() {
    const code = referralQuery.data?.code.code;
    if (!code || sharingReferral) return;
    setSharingReferral(true);
    try {
      await NativeShare.share({ message: code }, { dialogTitle: "Share referral" });
    } catch {
      showToast({ title: "The share sheet could not be opened.", duration: 2_500 });
    } finally {
      setSharingReferral(false);
    }
  }

  function closeReferralSheet() {
    setSheet(undefined);
    onReferralSheetClose?.();
  }

  async function submitReferralCode() {
    if (!referralCodeValid || redeemingReferral || referralRedemption) return;
    setRedeemingReferral(true);
    setReferralRedemptionError("");
    try {
      setReferralRedemption(await redeemReferralCode(normalizedReferralCode));
    } catch (error) {
      setReferralRedemptionError(referralRedemptionErrorMessage(error));
    } finally {
      setRedeemingReferral(false);
    }
  }

  return <>
    <AccountScreenShell rightAction={headerActions} title={page === "profile" ? "Profile" : "Settings"}>
      {page === "profile" ? <View style={styles.content}>
        <Button accessibilityLabel={generatingBadge ? "Generating profile badge" : "Change profile image"} contentMode="raw" disabled={generatingBadge} iconOnly onPress={() => setSheet("avatar-actions")} size="xl" style={styles.avatarButton} variant="ghost">
          <Avatar fallback={profileInitial(user)} size={104} style={styles.avatar} uri={user?.avatarUrl}>
            {generatingBadge ? <Skeleton accessibilityLabel="Generating profile badge" accessibilityRole="progressbar" style={styles.avatarSkeleton} /> : undefined}
          </Avatar>
        </Button>
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
        <View style={styles.settingsGrid}>
          <SettingsActionCard icon={<IssueIcon size="lg" />} label="Report issue" onPress={() => router.push({ pathname: "/capability/[slug]", params: { slug: "signal", tab: "unread", inbox: "internal", compose: "issue" } })} size={settingsCardSize} />
          <SettingsActionCard icon={<FeedbackIcon size="lg" />} label="Feedback" onPress={() => router.push({ pathname: "/capability/[slug]", params: { slug: "signal", tab: "unread", inbox: "internal", compose: "feedback" } })} size={settingsCardSize} />
          <SettingsActionCard icon={<FaqIcon size="lg" />} label="FAQ" onPress={() => { setFaqQuestionIndex(undefined); setSheet("faq"); }} size={settingsCardSize} />
          <SettingsActionCard icon={<TermsIcon size="lg" />} label="Terms" onPress={() => setSheet("terms")} size={settingsCardSize} />
          <SettingsActionCard icon={<PrivacyIcon size="lg" />} label="Privacy" onPress={() => setSheet("privacy")} size={settingsCardSize} />
          <SettingsActionCard icon={<ReferralIcon size="lg" />} label="Referral" onPress={() => { setReferralMode("share"); setSheet("referral"); }} size={settingsCardSize} />
          <SettingsActionCard icon={<WalletIcon size="lg" />} label="Wallet" onPress={() => setSheet("wallet")} size={settingsCardSize} />
          <SettingsActionCard icon={<SparksIcon size="lg" />} label="Spark costs" onPress={openCostDetails} size={settingsCardSize} />
          {subscriptionView?.action === "cancel" ? <SettingsActionCard danger icon={<SubscriptionCancelIcon size="lg" variant="danger" />} label="Cancel subscription" onPress={() => { if (!cancelSubscription.isPending) setSheet("cancel-subscription"); }} size={settingsCardSize} /> : null}
          <SettingsActionCard danger icon={<DeleteAccountIcon size="lg" variant="danger" />} label="Delete account" onPress={() => setSheet("delete-account")} size={settingsCardSize} />
          <SettingsActionCard danger icon={<SignOutIcon size="lg" variant="danger" />} label="Log out" onPress={() => void logOut()} size={settingsCardSize} />
        </View>
      </View>}
    </AccountScreenShell>

    <BottomSheet hideHeading onOpenChange={(open) => { if (!open) setSheet(undefined); }} open={sheet === "avatar-actions"} title="Profile image actions">
      <BottomSheetMenu>
        <BottomSheetItem onPress={() => setSheet("badge-generate")} style={styles.profileImageAction} textStyle={styles.profileImageActionText}>Generate badge</BottomSheetItem>
        <BottomSheetItem onPress={() => { setSheet(undefined); void pickAvatar().catch(() => showToast({ title: "The image picker could not be opened.", duration: 2_500 })); }} style={styles.profileImageAction} textStyle={styles.profileImageActionText}>Choose image</BottomSheetItem>
      </BottomSheetMenu>
    </BottomSheet>

    <BottomSheet description={badgeCost ? `Generate a custom profile badge for ${badgeCost.sparkCost} Sparks.` : "Generate a custom profile badge."} footer={<><Button disabled={!badgeCost} onPress={() => void generateBadge()} size="md" variant="primary">Generate badge</Button><Button onPress={() => setSheet(undefined)} size="md" variant="secondary">Close</Button></>} height="full" onOpenChange={(open) => { if (!open) setSheet(undefined); }} open={sheet === "badge-generate"} title="Your profile badge">
      <View style={styles.badgeContent}>
        <View style={styles.badgePreview}><Avatar fallback={profileInitial(user)} size={148} style={styles.badgeAvatar} /></View>
        {!badgeCost ? <Button onPress={() => void refreshProducts()} size="md" variant="ghost">Refresh costs</Button> : null}
      </View>
    </BottomSheet>

    <BottomSheet footer={<Button onPress={() => setSheet(undefined)} size="md" variant="secondary">Close</Button>} onOpenChange={(open) => { if (!open) setSheet(undefined); }} open={sheet === "scope-help"} title="Scopes">
      <Text style={styles.scopeHelp}>Scopes are separate workspaces for different parts of your life. For example, you can create one for work and another for personal use, keeping their content, conversations, and tools organized independently.</Text>
    </BottomSheet>

    <BottomSheet footer={<><Button onPress={() => { setWalletHelp(undefined); setSheet(undefined); openPaywall(); }} size="md" variant="primary">Buy more</Button><Button onPress={() => { setWalletHelp(undefined); setSheet(undefined); }} size="md" variant="secondary">Close</Button></>} height="full" onOpenChange={(open) => { if (!open) { setWalletHelp(undefined); setSheet(undefined); } }} open={sheet === "wallet"} title="Wallet">
      <WalletSheet onOpenHelp={setWalletHelp} userKey={user?.key} />
    </BottomSheet>

    <BottomSheet footer={<Button onPress={() => setWalletHelp(undefined)} size="md" variant="secondary">Close</Button>} onOpenChange={(open) => { if (!open) setWalletHelp(undefined); }} open={sheet === "wallet" && Boolean(walletHelp)} title={walletHelp === "ai" ? "AI usage" : walletHelp === "charges" ? "Charges" : "Storage"}>
      <Text style={styles.scopeHelp}>{walletHelp === "ai" ? "This is Sparks spent on AI that does not have a listed static Spark charge, such as chatting in Core. Actions with a set price appear under Charges." : walletHelp === "charges" ? "Charges are each time Sparks were spent on an action with a set price, such as creating an audio book or connecting email. Other AI spend is shown above as AI usage." : "Storage reflects tracked files and media across your apps. Usage is measured continuously and charged in Sparks each hour. The monthly amount shown is an estimate at your current usage. If storage remains unfunded for 90 days, your tracked stored data becomes eligible for deletion."}</Text>
    </BottomSheet>

    <BottomSheet description={TERMS_COPY.eyebrow} footer={<Button onPress={() => setSheet(undefined)} size="md" variant="secondary">Close</Button>} height="full" onOpenChange={(open) => { if (!open) setSheet(undefined); }} open={sheet === "terms"} title="Terms of service">
      <LegalSheetContent copy={TERMS_COPY} />
    </BottomSheet>

    <BottomSheet description={PRIVACY_COPY.eyebrow} footer={<Button onPress={() => setSheet(undefined)} size="md" variant="secondary">Close</Button>} height="full" onOpenChange={(open) => { if (!open) setSheet(undefined); }} open={sheet === "privacy"} title="Privacy policy">
      <LegalSheetContent copy={PRIVACY_COPY} />
    </BottomSheet>

    <BottomSheet hideHeading onOpenChange={(open) => { if (!open) setSheet(undefined); }} open={sheet === "scope-actions" && canManageScope(selectedScope)} title="Scope actions">
      <BottomSheetMenu>
        <BottomSheetItem onPress={prioritizeSelectedScope} style={styles.scopeActionItem}>Prioritize</BottomSheetItem>
        <BottomSheetItem onPress={() => void changeSelectedScopeCover()} style={styles.scopeActionItem}>Change cover</BottomSheetItem>
        {canDeleteSelectedScope ? <BottomSheetItem onPress={() => setSheet("scope-delete")} style={styles.scopeActionItem}>Delete</BottomSheetItem> : null}
      </BottomSheetMenu>
    </BottomSheet>

    <BottomSheet dismissible={!deletingScope} footer={<><Button onPress={deleteSelectedScope} size="md" variant="primary">Delete</Button><Button disabled={deletingScope} onPress={() => setSheet(undefined)} size="md" variant="secondary">Close</Button></>} onOpenChange={(open) => { if (!open && !deletingScope) setSheet(undefined); }} open={sheet === "scope-delete" && canDeleteSelectedScope} title="Delete scope?">
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

    <BottomSheet focusKey="profile-cancel-subscription" footer={<><Button onPress={confirmSubscriptionCancellation} size="md" variant="primary">Cancel subscription</Button><Button onPress={() => setSheet(undefined)} size="md" variant="secondary">Close</Button></>} onOpenChange={(open) => { if (!open) setSheet(undefined); }} open={sheet === "cancel-subscription"} title="Cancel subscription?">
      <Text style={styles.scopeHelp}>{cancellationPeriodEnd ? `Your subscription remains active until ${cancellationPeriodEnd}, then it will not renew.` : "Your subscription remains active through the current billing period, then it will not renew."}</Text>
    </BottomSheet>

    <BottomSheet dismissible={!accountDeletionPending} focusKey="profile-delete-account" footer={<><Button disabled={accountDeletionPending} onPress={permanentlyDeleteAccount} size="md" variant="primary">Delete</Button><Button disabled={accountDeletionPending} onPress={() => setSheet(undefined)} size="md" variant="secondary">Close</Button></>} onOpenChange={(open) => { if (!open && !accountDeletionPending) setSheet(undefined); }} open={sheet === "delete-account"} title="Delete account?" />

    <BottomSheet description={referralMode === "share" ? "Invite a friend with your code and earn Sparks as they get started." : "Apply the referral code from the person who invited you."} dismissible={!redeemingReferral} focusKey="profile-referral" footer={<>{referralMode === "share" ? referralUnused ? <Button disabled={sharingReferral} loading={sharingReferral} onPress={() => void shareReferral()} size="md" variant="primary">Share</Button> : null : <Button disabled={!referralCodeValid || redeemingReferral || Boolean(referralRedemption)} loading={redeemingReferral} onPress={() => void submitReferralCode()} size="md" variant="primary">{referralRedemption ? "Code applied" : "Use code"}</Button>}<Button disabled={redeemingReferral} onPress={closeReferralSheet} size="md" variant="secondary">Close</Button></>} height="full" onOpenChange={(open) => { if (!open && !redeemingReferral) closeReferralSheet(); }} open={sheet === "referral"} title="Referral">
      <ScrollView contentContainerStyle={styles.referralContent} showsVerticalScrollIndicator={false}>
        <Tabs accessibilityLabel="Referral settings" accessibilityRole="tablist" style={styles.referralTabs}><Button accessibilityRole="tab" accessibilityState={{ selected: referralMode === "share" }} onPress={() => setReferralMode("share")} size="xs" style={styles.referralTab} variant={referralMode === "share" ? "secondary" : "ghost"}>My code</Button><Button accessibilityRole="tab" accessibilityState={{ selected: referralMode === "redeem" }} onPress={() => setReferralMode("redeem")} size="xs" style={styles.referralTab} variant={referralMode === "redeem" ? "secondary" : "ghost"}>Use code</Button></Tabs>
        {referralMode === "share" ? <>
          <View style={styles.referralHero}><View style={styles.referralIcon}><View style={styles.referralIconScale}><ReferralIcon size="lg" /></View></View><Text style={styles.referralCopy}>Earn 50 Sparks when your friend signs up, plus 100 more when they start their first subscription.</Text></View>
          {referralQuery.isPending ? <Text style={styles.referralState}>Loading your referral status...</Text> : referralQuery.isError ? <View style={styles.referralStateBlock}><Text accessibilityRole="alert" style={styles.deleteError}>Your referral status could not be loaded.</Text><Button onPress={() => void referralQuery.refetch()} size="md" variant="secondary">Retry</Button></View> : referralQuery.data ? referralUnused ? <View style={styles.referralCodeBlock}><Text style={styles.referralLabel}>YOUR CODE</Text><Text selectable style={styles.referralCode}>{referralQuery.data.code.code}</Text></View> : referralQuery.data.invitees.length === 0 ? <Text style={styles.referralState}>{referralQuery.data.attributionCount} {referralQuery.data.attributionCount === 1 ? "friend has" : "friends have"} joined. Detailed milestones will be available shortly.</Text> : <View style={styles.referralInvitees}>{referralQuery.data.invitees.map((invitee, index) => <View key={`${invitee.displayName ?? "friend"}-${index}`} style={styles.referralInvitee}><Text style={styles.referralInviteeName}>{invitee.displayName ?? "Invited friend"}</Text><View style={styles.referralMilestone}><Text style={styles.referralMilestoneReward}>50 Sparks</Text><Text style={invitee.signupRewardEarned ? styles.referralEarned : styles.referralPending}>{invitee.signupRewardEarned ? "Earned" : "Pending"}</Text></View><View style={styles.referralMilestone}><Text style={styles.referralMilestoneReward}>100 Sparks</Text><Text style={invitee.firstPaidRewardStatus === "earned" ? styles.referralEarned : styles.referralPending}>{invitee.firstPaidRewardStatus === "earned" ? "Earned" : invitee.firstPaidRewardStatus === "reversed" ? "Reversed" : "Pending"}</Text></View></View>)}</View> : null}
        </> : <View style={styles.referralRedeemForm}>
          <Text style={styles.inputLabel}>Referral code</Text>
          <TextInput accessibilityLabel="Referral code" autoCapitalize="characters" autoCorrect={false} autoFocusInBottomSheet={false} editable={!redeemingReferral && !referralRedemption} maxLength={64} onChangeText={(value) => { setReferralCode(value.toUpperCase()); setReferralRedemptionError(""); }} onSubmitEditing={() => void submitReferralCode()} placeholder="12-character code" ref={referralCodeInputRef} returnKeyType="done" value={referralCode} />
          {referralCode && !referralCodeValid ? <Text accessibilityRole="alert" style={styles.deleteError}>Enter a 12-character code using 0-9 and A-F.</Text> : null}
          {referralRedemptionError ? <Text accessibilityRole="alert" style={styles.deleteError}>{referralRedemptionError}</Text> : null}
          {referralRedemption ? <View accessibilityLiveRegion="polite" style={styles.referralSuccess}><Text style={styles.referralSuccessTitle}>{referralRedemption.status === "applied" ? "Referral code applied" : "Referral code already applied"}</Text><Text style={styles.referralState}>{referralRedemption.referrerName ? `Invited by ${referralRedemption.referrerName}.` : "Your referral is connected."}</Text><View style={styles.referralMilestone}><Text style={styles.referralMilestoneReward}>Sign-up reward</Text><Text style={styles.referralEarned}>Issued</Text></View><View style={styles.referralMilestone}><Text style={styles.referralMilestoneReward}>First subscription reward</Text><Text style={referralRedemption.firstPaidRewardStatus === "earned" ? styles.referralEarned : styles.referralPending}>{referralRedemption.firstPaidRewardStatus === "earned" ? "Earned" : referralRedemption.firstPaidRewardStatus === "reversed" ? "Reversed" : "Pending"}</Text></View></View> : null}
        </View>}
      </ScrollView>
    </BottomSheet>

    <BottomSheet description="Quick answers about using Core and its connected apps, plus Sparks and plans." focusKey="profile-faq" footer={<Button onPress={() => setSheet(undefined)} size="md" variant="secondary">Close</Button>} height="full" onOpenChange={(open) => { if (!open) { setFaqQuestionIndex(undefined); setSheet(undefined); } }} open={sheet === "faq"} title="FAQ">
      <ScrollView contentContainerStyle={styles.faqList}>{FAQ.map(([question], index) => <Button accessibilityLabel={`Read ${question}`} contentMode="raw" key={question} onPress={() => setFaqQuestionIndex(index)} shape="pill" size="md" style={styles.faqPill} variant="secondary"><Text numberOfLines={2} style={styles.faqQuestion}>{question}</Text></Button>)}</ScrollView>
    </BottomSheet>

    <BottomSheet focusKey="profile-faq-answer" footer={<Button onPress={() => setFaqQuestionIndex(undefined)} size="md" variant="secondary">Close</Button>} onOpenChange={(open) => { if (!open) setFaqQuestionIndex(undefined); }} open={sheet === "faq" && Boolean(selectedFaq)} title={selectedFaq?.[0] ?? "FAQ answer"}>
      {selectedFaq ? <Text style={styles.faqAnswer}>{selectedFaq[1]}</Text> : null}
    </BottomSheet>

    <BottomSheet focusKey="profile-name" footer={<><Button disabled={!nameDraft.trim()} onPress={saveName} size="md" variant="primary">Save</Button><Button onPress={() => setSheet(undefined)} size="md" variant="secondary">Close</Button></>} height="full" onOpenChange={(open) => { if (!open) setSheet(undefined); }} open={sheet === "name"} title="Edit name">
      <View style={styles.form}><Text style={styles.inputLabel}>Name</Text><TextInput accessibilityLabel="Name" maxLength={200} onChangeText={setNameDraft} onSubmitEditing={saveName} placeholder="Name" returnKeyType="done" value={nameDraft} /></View>
    </BottomSheet>

  </>;
}

const styles = StyleSheet.create({
  content: { alignItems: "center", flexGrow: 1, paddingHorizontal: spacing.md, paddingTop: spacing.xl },
  settingsContent: { flexGrow: 1, paddingHorizontal: spacing.md, paddingTop: spacing.md },
  settingsGrid: { alignContent: "flex-start", flexDirection: "row", flexWrap: "wrap", gap: 10, width: "100%" },
  settingsCard: { backgroundColor: palette.panelRaised, borderColor: palette.hairline, borderRadius: radii.md, borderWidth: 1, overflow: "hidden" },
  settingsCardButton: { flexDirection: "column", gap: 10, height: "100%", paddingHorizontal: 8, width: "100%" },
  settingsCardLabel: { color: palette.silver100, fontFamily: fonts.medium, fontSize: 12, textAlign: "center", width: "100%" },
  settingsCardLabelDanger: { color: palette.danger },
  avatarButton: { height: 112, width: 112 },
  avatar: { backgroundColor: palette.voidBlack, borderColor: palette.hairlineBright, borderWidth: 1 },
  avatarSkeleton: { backgroundColor: palette.hairlineBright, borderColor: palette.hairline, borderRadius: 999, borderWidth: 1, height: 104, opacity: 0.72, overflow: "hidden", width: 104 },
  profileImageAction: { justifyContent: "center" },
  profileImageActionText: { textAlign: "center", width: "100%" },
  badgeAvatar: { backgroundColor: palette.voidBlack },
  badgeContent: { alignItems: "center", flex: 1, gap: spacing.md, justifyContent: "center" },
  badgePreview: { alignSelf: "center", borderColor: palette.hairlineBright, borderRadius: 999, borderWidth: 1, overflow: "hidden" },
  identity: { alignItems: "center", gap: spacing.xs, marginTop: spacing.md },
  nameButton: { maxWidth: "100%", paddingHorizontal: spacing.sm },
  name: { color: palette.silver50, flexShrink: 1, fontFamily: fonts.medium, fontSize: 28, lineHeight: 34, textAlign: "center" },
  email: { color: palette.silver500, fontFamily: fonts.regular, fontSize: 14 },
  form: { gap: spacing.sm },
  inputLabel: { color: palette.silver300, fontFamily: fonts.medium, fontSize: 12, letterSpacing: 0.4, marginLeft: 2 },
  reportInput: { minHeight: 180 },
  faqList: { gap: spacing.sm, paddingBottom: spacing.lg },
  faqPill: { justifyContent: "flex-start", minHeight: 40, paddingHorizontal: spacing.md, width: "100%" },
  faqQuestion: { color: palette.silver100, flexShrink: 1, fontFamily: fonts.regular, fontSize: 13, lineHeight: 17, textAlign: "left" },
  faqAnswer: { color: palette.silver300, fontFamily: fonts.regular, fontSize: 15, lineHeight: 23, paddingBottom: spacing.md },
  legalContent: { gap: spacing.md, paddingBottom: spacing.lg },
  legalSection: { gap: spacing.sm, paddingTop: spacing.sm },
  legalParagraph: { color: palette.silver300, fontFamily: fonts.regular, fontSize: 15, lineHeight: 23 },
  legalFootnote: { color: palette.silver500, fontFamily: fonts.regular, fontSize: 13, lineHeight: 20, paddingTop: spacing.sm },
  referralContent: { flexGrow: 1, gap: spacing.xl, paddingBottom: spacing.lg },
  referralTabs: { alignSelf: "stretch", width: "100%" },
  referralTab: { flex: 1 },
  referralHero: { alignItems: "center", gap: spacing.lg, paddingTop: spacing.lg },
  referralIcon: { alignItems: "center", height: 88, justifyContent: "center", width: 88 },
  referralIconScale: { transform: [{ scale: 2 }] },
  referralCopy: { color: palette.silver300, fontFamily: fonts.regular, fontSize: 14, lineHeight: 21, maxWidth: 350, textAlign: "center" },
  referralState: { color: palette.silver300, fontFamily: fonts.regular, fontSize: 14, textAlign: "center" },
  referralStateBlock: { alignItems: "center", gap: spacing.md },
  referralCodeBlock: { alignItems: "center", gap: spacing.xs },
  referralLabel: { color: palette.silver500, fontFamily: fonts.medium, fontSize: 10, letterSpacing: 2 },
  referralCode: { color: palette.chromeWhite, fontFamily: fonts.medium, fontSize: 30, letterSpacing: 4 },
  referralInvitees: { gap: spacing.sm },
  referralInvitee: { borderColor: palette.hairline, borderRadius: radii.md, borderWidth: 1, gap: spacing.sm, padding: spacing.md },
  referralInviteeName: { color: palette.silver50, fontFamily: fonts.medium, fontSize: 15 },
  referralMilestone: { alignItems: "center", flexDirection: "row", justifyContent: "space-between" },
  referralMilestoneReward: { color: palette.silver300, fontFamily: fonts.regular, fontSize: 13 },
  referralEarned: { color: palette.silver50, fontFamily: fonts.medium, fontSize: 12 },
  referralPending: { color: palette.silver500, fontFamily: fonts.medium, fontSize: 12 },
  referralRedeemForm: { gap: spacing.sm },
  referralSuccess: { borderColor: palette.hairline, borderRadius: radii.md, borderWidth: 1, gap: spacing.md, marginTop: spacing.sm, padding: spacing.md },
  referralSuccessTitle: { color: palette.silver50, fontFamily: fonts.medium, fontSize: 16, textAlign: "center" },
  deleteError: { color: palette.danger, fontFamily: fonts.regular, fontSize: 13, lineHeight: 19 },
  scopeSection: { alignSelf: "stretch", gap: spacing.sm, marginTop: spacing.xl, width: "100%" },
  scopeActionItem: { justifyContent: "center" },
  scopeTitleRow: { alignItems: "center", flexDirection: "row", justifyContent: "space-between", minHeight: 32 },
  scopeTitle: { color: palette.silver100, fontFamily: fonts.medium, fontSize: 16 },
  scopeHelp: { color: palette.silver300, fontFamily: fonts.regular, fontSize: 15, lineHeight: 23, paddingBottom: spacing.md },
  scopeGrid: { alignContent: "flex-start", flexDirection: "row", flexWrap: "wrap", gap: 10, width: "100%" },
  scopeCard: { backgroundColor: palette.panelRaised, borderColor: palette.hairline, borderRadius: radii.md, borderWidth: 1, overflow: "hidden", position: "relative" },
  scopeCardSelected: { borderColor: palette.silver50, elevation: 4, shadowColor: palette.silver50, shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.62, shadowRadius: 5 },
  scopeCardButton: { flexDirection: "column", gap: 10, height: "100%", paddingHorizontal: 8, width: "100%" },
  scopeCardButtonCovered: { justifyContent: "flex-end", paddingBottom: 10 },
  scopeCardLabel: { color: palette.silver100, fontFamily: fonts.medium, fontSize: 12, textAlign: "center", width: "100%" },
  scopeCardLabelCovered: { paddingHorizontal: 5, paddingVertical: 4, borderRadius: radii.sm, backgroundColor: "rgba(0, 0, 0, 0.68)", color: "#FFFFFF" },
  scopeCover: { bottom: 0, left: 0, position: "absolute", right: 0, top: 0 },
  scopeSelectedBadge: { alignItems: "center", backgroundColor: palette.silver50, borderRadius: 10, height: 20, justifyContent: "center", position: "absolute", right: 4, top: 4, width: 20 },
  scopeSkeleton: { backgroundColor: palette.hairlineBright, borderRadius: radii.md, opacity: 0.72 },
  scopeState: { alignItems: "center", gap: spacing.md, paddingVertical: spacing.xl, width: "100%" },
});
