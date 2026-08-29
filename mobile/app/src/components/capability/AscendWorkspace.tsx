import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { randomUUID } from "expo-crypto";
import * as Haptics from "expo-haptics";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { useEffect, useRef, useState } from "react";
import {
  AccessibilityInfo,
  Animated,
  Keyboard,
  KeyboardAvoidingView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput as NativeTextInput,
  View,
  useWindowDimensions,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  BottomSheet,
  BottomSheetItem,
} from "@vorinthex/shared/ui/bottom-sheet";
import { ActionPill } from "@vorinthex/shared/ui/action-pill";
import { AiTextEditor } from "@vorinthex/shared/ui/ai-text-editor";
import { Button, ButtonSizeProvider } from "@vorinthex/shared/ui/button";
import { CoreComposer } from "@vorinthex/shared/ui/core-composer";
import { Skeleton } from "@vorinthex/shared/ui/skeleton";
import { Slider } from "@vorinthex/shared/ui/slider";
import { Switch } from "@vorinthex/shared/ui/switch";
import { Tabs } from "@vorinthex/shared/ui/tabs";
import { TextInput } from "@vorinthex/shared/ui/text-input";
import { useToast } from "@vorinthex/shared/ui/toast";
import {
  CheckIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  CloseIcon,
  FileIcon,
  FilterIcon,
  MoreHorizontalIcon,
  PauseIcon,
  PlayIcon,
  PlusIcon,
  SearchIcon,
  SendIcon,
} from "@vorinthex/shared/ui/icons-mobile";

import { ChromeIcon } from "@/components/ChromeIcon";
import { SearchHistorySheet } from "@/components/SearchHistorySheet";
import { BookSharing } from "@/components/capability/BookSharing";
import { EmailAttachmentPicker, type EmailAttachmentLabels } from "@/components/capability/EmailAttachmentPicker";
import { WorkspaceAppSwitcher } from "@/components/capability/WorkspaceAppSwitcher";
import { assistantIconSource } from "@/data/capability-icons";
import { enhanceAppTextForContext, translateAppTextForContext } from "@/lib/app-transformation-client";
import { languageForCountryCode } from "@/lib/auth-helpers";
import { audioTimelineDuration, audioTimelinePosition, formatAudioTime, resolveAudioTimelinePosition } from "@/lib/audio-playback-timeline";
import { useBookPlayback } from "@/lib/book-playback";
import { restoredBookDraft, retryBookCreateRequestKey, type FailedBookCreate } from "@/lib/book-create-retry";
import {
  askBookAssistant,
  cancelBook,
  createBook,
  deleteBook,
  extendBook,
  fetchBookDetail,
  fetchBooksOverview,
  getBooksContext,
  previewBookExtension,
  retryBook,
  setBookFavorite,
  suggestBookGoals,
  suggestBookTopics,
  type Book,
  type BookChapter,
  BookClientError,
  type BookDetail,
  type BookStatus,
  type CreateBookInput,
  type ExtensionChapterCount,
} from "@/lib/books-client";
import { deleteContentSearchHistory, getContentContext, type ContentSearchHistoryItem } from "@/lib/content-client";
import { attachmentIdentity } from "@/lib/email-attachment-picker";
import type { EmailAttachmentRef } from "@/lib/email-client";
import {
  addCachedBook,
  ascendQueryKeys,
  invalidateAssistantChanges,
  mergeBookDetailProgress,
  patchCachedBook,
  patchCachedBookMetadata,
  removeCachedBook,
} from "@/lib/workspace-query-cache";
import {
  getUserSearchHistory,
  promoteCachedUserSearchHistory,
  removeCachedUserSearchHistory,
  userSearchHistoryQueryKey,
} from "@/lib/user-search-history-cache";
import { useAuthStore } from "@/state/auth";
import { fonts, palette, radii, spacing, tracking } from "@/theme/tokens";

const COLUMNS = 3;
const GRID_GAP = 8;
const ACTIVE_STATUSES: BookStatus[] = [
  "queued",
  "researching",
  "planning",
  "writing",
  "narrating",
  "finalizing",
];
const EXTENSION_CHAPTER_OPTIONS = [1, 3, 5] as const;
const MAX_CONTEXT_DOCUMENTS = 50;
const DEFAULT_NARRATOR = { key: "clear" as const, name: "Clear" };
const CORE_PROMPTS = [
  "Write a field guide to deep work",
  "Create an audio book about lucid dreaming",
  "Turn my idea into a short handbook",
] as const;
const GRADIENTS = [
  ["#30363D", "#0A0E13", "#020304"],
  ["#283139", "#11161C", "#050607"],
  ["#3B3A38", "#171512", "#050504"],
] as const;

function formatBookDuration(minutes: number) {
  const safeMinutes = Math.max(1, Math.ceil(minutes));
  const hours = Math.floor(safeMinutes / 60);
  const remainingMinutes = safeMinutes % 60;
  return [hours ? `${hours}h` : "", remainingMinutes ? `${remainingMinutes}${remainingMinutes === 1 ? "min" : "mins"}` : ""].filter(Boolean).join(" ");
}

type LibrarySheet =
  | "actions"
  | "filter"
  | "searchHistory"
  | "reader"
  | "chapterRead"
  | "bookSummary"
  | "bookActions"
  | "bulkActions"
  | "bulkDelete"
  | "delete";
type Draft = CreateBookInput;
type BriefEditorTarget = "topic" | "goal";
type BriefTransformation = Readonly<{ target: BriefEditorTarget; action: "enhance" | "translate" }>;
type PendingRequest = {
  book: Book;
  input: CreateBookInput;
  requestKey: string;
};
const INITIAL_DRAFT: Draft = {
  topic: "",
  goal: "",
  currentKnowledge: "",
  language: "English",
  writingTone: "Clear and practical",
  narratorVoiceKey: DEFAULT_NARRATOR.key,
  narrationPace: 1,
  archiveDocumentKeys: [],
  chapterImages: true,
};

function errorMessage(error: unknown) {
  return error instanceof Error
    ? error.message
    : "The request could not be completed.";
}
function statusLabel(status: BookStatus) {
  return status.charAt(0).toUpperCase() + status.slice(1);
}

export function Cover({ book, index = 0 }: { book: Book; index?: number }) {
  if (book.coverUrl)
    return (
      <Image
        accessibilityLabel={`${book.title} audio book cover`}
        contentFit="cover"
        source={book.coverUrl}
        style={styles.cover}
        transition={180}
      />
    );
  return (
    <LinearGradient
      colors={GRADIENTS[index % GRADIENTS.length]!}
      end={{ x: 1, y: 1 }}
      start={{ x: 0, y: 0 }}
      style={styles.cover}
    />
  );
}

export function ChapterCard({ chapter, reducedMotion, width, onPress }: { chapter: BookChapter; reducedMotion: boolean; width: number; onPress?: () => void }) {
  const [entrance] = useState(() => new Animated.Value(reducedMotion ? 1 : 0));
  useEffect(() => {
    if (reducedMotion) { entrance.setValue(1); return; }
    const animation = Animated.spring(entrance, { toValue: 1, damping: 15, stiffness: 180, mass: 0.8, useNativeDriver: true });
    animation.start();
    return () => animation.stop();
  }, [entrance, reducedMotion]);
  return (
    <Animated.View style={{ width, height: (width * 16) / 9, opacity: entrance, transform: [{ scale: entrance.interpolate({ inputRange: [0, 1], outputRange: [0.88, 1] }) }] }}>
      <Button accessibilityLabel={`Chapter ${chapter.position}, ${chapter.title}. ${chapter.description}${chapter.isCompleted ? ", completed" : ""}`} contentMode="raw" disabled={!onPress} onPress={onPress} shape="rounded" size="md" style={[styles.chapterCard, styles.chapterCardFill]} variant="ghost">
        {chapter.imageUrl ? <Image contentFit="cover" source={chapter.imageUrl} style={styles.cover} /> : <LinearGradient colors={GRADIENTS[(chapter.position - 1) % GRADIENTS.length]!} style={styles.cover} />}
        <LinearGradient colors={["transparent", "rgba(0,0,0,0.08)", "rgba(0,0,0,0.58)"]} locations={[0, 0.58, 1]} style={styles.cardShade} />
        <View style={styles.cardCopy}>
          <Text style={styles.chapterNumber}>{String(chapter.position).padStart(2, "0")}</Text>
          <Text numberOfLines={2} style={styles.cardTitle}>{chapter.title}</Text>
          {!chapter.content || !chapter.audioUrl ? <Text numberOfLines={4} style={styles.cardSummary}>{chapter.description}</Text> : null}
        </View>
      </Button>
    </Animated.View>
  );
}

type ReaderProps = {
  chapter?: BookChapter;
};

export function Reader({ chapter }: ReaderProps) {
  return (
    <View style={styles.chapterSummaryPanel}>
      <Text selectable style={styles.chapterSummaryText}>{chapter?.description || "Summary is unavailable for this chapter."}</Text>
    </View>
  );
}

function ChapterReading({ chapter }: { chapter?: BookChapter }) {
  const paragraphs = (chapter?.content ?? "")
    .replace(/\r\n?/g, "\n")
    .replace(/\\n/g, "\n")
    .split(/\n\s*\n|\n+/)
    .map((paragraph) => paragraph.replace(/\s+/g, " ").trim())
    .filter(Boolean);
  return (
    <ScrollView contentContainerStyle={styles.chapterReadingContent} showsVerticalScrollIndicator={false} style={styles.chapterReadingScroll}>
      {paragraphs.length ? paragraphs.map((paragraph, index) => <Text key={index} selectable style={styles.chapterReadingParagraph}>{paragraph}</Text>) : <Text style={styles.chapterReadingUnavailable}>Full chapter text is unavailable.</Text>}
    </ScrollView>
  );
}

export function AscendWorkspace() {
  const queryClient = useQueryClient();
  const playback = useBookPlayback();
  const context = getBooksContext();
  const contentContext = getContentContext();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const { showToast } = useToast();
  const countryCode = useAuthStore((state) => state.user?.countryCode);
  const [gridWidth, setGridWidth] = useState(0);
  const [chapterGridWidth, setChapterGridWidth] = useState(0);
  const [sheet, setSheet] = useState<LibrarySheet>();
  const [sheetOpen, setSheetOpen] = useState(false);
  const [createTopicOpen, setCreateTopicOpen] = useState(false);
  const [createTopicCustomOpen, setCreateTopicCustomOpen] = useState(false);
  const [createGoalOpen, setCreateGoalOpen] = useState(false);
  const [createGoalCustomOpen, setCreateGoalCustomOpen] = useState(false);
  const [createDetailsOpen, setCreateDetailsOpen] = useState(false);
  const [contextPickerOpen, setContextPickerOpen] = useState(false);
  const [contextLabels, setContextLabels] = useState<EmailAttachmentLabels>({});
  const [contextGridWidth, setContextGridWidth] = useState(0);
  const [selectedBookKey, setSelectedBookKey] = useState<string>();
  const [readerChapterKey, setReaderChapterKey] = useState<string>();
  const [readingChapterKey, setReadingChapterKey] = useState<string>();
  const [playbackScrubValue, setPlaybackScrubValue] = useState<number>();
  const [playbackIslandDismissed, setPlaybackIslandDismissed] = useState(false);
  const [sharingBook, setSharingBook] = useState<Book>();
  const [extensionOpen, setExtensionOpen] = useState(false);
  const [extensionChapterCount, setExtensionChapterCount] = useState<ExtensionChapterCount>(1);
  const [extensionTitles, setExtensionTitles] = useState<string[]>([]);
  const [extensionPreviewReady, setExtensionPreviewReady] = useState(false);
  const [extensionError, setExtensionError] = useState<string>();
  const [selectedBookKeys, setSelectedBookKeys] = useState<string[]>([]);
  const [bulkLoading, setBulkLoading] = useState(false);
  const [bookPageOpen, setBookPageOpen] = useState(false);
  const [revealedChapterCount, setRevealedChapterCount] = useState(0);
  const [reducedChapterMotion, setReducedChapterMotion] = useState(false);
  const [query, setQuery] = useState("");
  const [showOnlyFavorites, setShowOnlyFavorites] = useState(false);
  const [rootSearchFocusable, setRootSearchFocusable] = useState(true);
  const [aiInputFocused, setAiInputFocused] = useState(false);
  const [history, setHistory] = useState<ContentSearchHistoryItem[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState<string>();
  const [removingHistoryQuery, setRemovingHistoryQuery] = useState<string>();
  const [draft, setDraft] = useState<Draft>(INITIAL_DRAFT);
  const [topicSuggestions, setTopicSuggestions] = useState<string[]>([]);
  const [topicSuggestionsError, setTopicSuggestionsError] = useState<string>();
  const [goalSuggestions, setGoalSuggestions] = useState<string[]>([]);
  const [goalSuggestionsError, setGoalSuggestionsError] = useState<string>();
  const [assistantInput, setAssistantInput] = useState("");
  const [assistantMessage, setAssistantMessage] = useState<string>();
  const [lifecycleError, setLifecycleError] = useState<string>();
  const [draftError, setDraftError] = useState<string>();
  const [briefActionTarget, setBriefActionTarget] = useState<BriefEditorTarget>();
  const [briefTranslateTarget, setBriefTranslateTarget] = useState<BriefEditorTarget>();
  const [briefTargetLanguage, setBriefTargetLanguage] = useState(() => languageForCountryCode(countryCode));
  const [briefTransformation, setBriefTransformation] = useState<BriefTransformation>();
  const assistantRequestKey = useRef<string | undefined>(undefined);
  const failedCreate = useRef<FailedBookCreate | undefined>(undefined);
  const rootSearchInputRef = useRef<NativeTextInput>(null);
  const rootSearchFocusTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const briefTransformationGeneration = useRef(0);
  const longPressedBook = useRef<string | undefined>(undefined);
  const bulkMutationLocked = useRef(false);
  const extensionPreviewGeneration = useRef(0);

  const overviewQuery = useQuery({
    queryKey: ascendQueryKeys.overview(context),
    queryFn: fetchBooksOverview,
    refetchInterval: (query) => query.state.data?.books.some(({ status }) => ACTIVE_STATUSES.includes(status)) ? 2_000 : false,
  });
  const pendingQuery = useQuery<PendingRequest[]>({
    enabled: false,
    queryKey: ascendQueryKeys.pending(context),
    queryFn: async () => [],
    initialData: [],
    staleTime: Infinity,
  });
  const detailQuery = useQuery({
    enabled: Boolean(
      selectedBookKey && !selectedBookKey.startsWith("pending-"),
    ),
    queryKey: ascendQueryKeys.detail(context, selectedBookKey ?? "none"),
    queryFn: async () => {
      const incoming = await fetchBookDetail(selectedBookKey!);
      return mergeBookDetailProgress(
        queryClient.getQueryData<BookDetail>(
          ascendQueryKeys.detail(context, selectedBookKey!),
        ),
        incoming,
      );
    },
    refetchInterval: (query) => query.state.data && ACTIVE_STATUSES.includes(query.state.data.book.status) ? 2_000 : false,
  });
  const serverBooks = overviewQuery.data?.books ?? [];
  const books = [...pendingQuery.data.map(({ book }) => book), ...serverBooks];
  const selectedBook =
    books.find(({ key }) => key === selectedBookKey) ?? detailQuery.data?.book;
  const selectedBooks = books.filter(({ key }) => selectedBookKeys.includes(key));
  const selectionActive = selectedBooks.length > 0;
  const allSelectedFavorite = selectionActive && selectedBooks.every(({ isFavorite }) => isFavorite);
  const detail = detailQuery.data;
  const filteredBooks = books.filter(
    (book) =>
      (!showOnlyFavorites || book.isFavorite) &&
      `${book.title} ${book.subtitle} ${book.description}`
        .toLowerCase()
        .includes(query.trim().toLowerCase()),
  );
  const cardWidth = Math.floor(
    ((gridWidth || width - spacing.md * 2) - GRID_GAP * (COLUMNS - 1)) /
      COLUMNS,
  );
  const chapterWidth = Math.floor(
    ((chapterGridWidth || width - spacing.md * 2) - GRID_GAP * (COLUMNS - 1)) /
      COLUMNS,
  );
  const dirty = JSON.stringify(draft) !== JSON.stringify(INITIAL_DRAFT);
  const creating = createTopicOpen || createTopicCustomOpen || createGoalOpen || createGoalCustomOpen || createDetailsOpen;
  const contextSelection: EmailAttachmentRef[] = draft.archiveDocumentKeys.map((key) => ({ type: "document", key }));
  const contextCardSize = Math.floor(((contextGridWidth || width - 40) - 18) / 4);

  useEffect(() => () => {
    if (rootSearchFocusTimer.current) clearTimeout(rootSearchFocusTimer.current);
  }, []);
  useEffect(() => {
    let mounted = true;
    void AccessibilityInfo.isReduceMotionEnabled().then((enabled) => { if (mounted) setReducedChapterMotion(enabled); });
    const subscription = AccessibilityInfo.addEventListener("reduceMotionChanged", setReducedChapterMotion);
    return () => { mounted = false; subscription.remove(); };
  }, []);
  const createMutation = useMutation({
    mutationFn: ({
      input,
      requestKey,
    }: {
      input: CreateBookInput;
      requestKey: string;
    }) => createBook(input, requestKey),
    onMutate: ({ input, requestKey }) => {
      const book: Book = {
        key: `pending-${requestKey}`,
        title: input.topic,
        subtitle: "Preparing your audio book",
        description: input.goal,
        status: "queued",
        isFavorite: false,
        narrator: DEFAULT_NARRATOR,
        estimatedMinutes: 10,
        chapterCount: 10,
        progressPercent: 0,
        generationProgressPercent: 0,
      };
      const pending = { book, input, requestKey };
      queryClient.setQueryData<PendingRequest[]>(
        ascendQueryKeys.pending(context),
        (current = []) => [
          pending,
          ...current.filter((item) => item.requestKey !== requestKey),
        ],
      );
      return { pending };
    },
    onSuccess: async (book, _variables, mutationContext) => {
      failedCreate.current = undefined;
      queryClient.setQueryData<PendingRequest[]>(
        ascendQueryKeys.pending(context),
        (current = []) =>
          current.filter(
            (item) => item.requestKey !== mutationContext?.pending.requestKey,
          ),
      );
      addCachedBook(queryClient, context, book);
      await queryClient.invalidateQueries({
        queryKey: ascendQueryKeys.overview(context),
        exact: true,
        refetchType: "active",
      });
    },
    onError: async (error, _variables, mutationContext) => {
      queryClient.setQueryData<PendingRequest[]>(
        ascendQueryKeys.pending(context),
        (current = []) =>
          current.filter(
            (item) => item.requestKey !== mutationContext?.pending.requestKey,
          ),
      );
      if (mutationContext?.pending) {
        failedCreate.current = {
          input: mutationContext.pending.input,
          requestKey: mutationContext.pending.requestKey,
        };
        setDraft(restoredBookDraft(failedCreate.current));
        setDraftError(
          `${errorMessage(error)} Your draft was restored so you can retry.`,
        );
        closeCreationSheets();
        setCreateDetailsOpen(true);
      }
      showToast({ title: errorMessage(error), duration: 3_000 });
      await queryClient.invalidateQueries({
        queryKey: ascendQueryKeys.overview(context),
        exact: true,
        refetchType: "active",
      });
    },
  });
  const lifecycleMutation = useMutation({
    onMutate: () => setLifecycleError(undefined),
    mutationFn: async ({
      action,
      book,
    }: {
      action: "retry" | "cancel" | "delete";
      book: Book;
    }) => {
      const requestKey = randomUUID();
      if (action === "delete") {
        await deleteBook(book.key, requestKey);
        return { action, book };
      }
      const updated =
        action === "retry"
          ? await retryBook(book.key, requestKey)
          : await cancelBook(book.key, requestKey);
      return { action, book: updated };
    },
    onSuccess: ({ action, book }) => {
      if (action === "delete") {
        removeCachedBook(queryClient, context, book.key);
        if (playback.playbackBookKey === book.key) playback.clear(false);
        setSelectedBookKey(undefined);
        setBookPageOpen(false);
        setSheetOpen(false);
      } else patchCachedBook(queryClient, context, book);
    },
    onError: (error, variables) => {
      if (error instanceof BookClientError && error.code === "BOOK_FAVORITE" && variables.action === "delete") {
        patchCachedBook(queryClient, context, { ...variables.book, isFavorite: true });
        setSheetOpen(false);
        setSheet(undefined);
        showToast({ title: "Can't delete favorite audio book", duration: 2_500 });
        return;
      }
      const message = errorMessage(error);
      setLifecycleError(message);
      showToast({ title: message, duration: 2_500 });
    },
  });
  const assistantMutation = useMutation({
    mutationFn: ({
      message,
      requestKey,
    }: {
      message: string;
      requestKey: string;
    }) => askBookAssistant(message, requestKey),
    onSuccess: async (result) => {
      setAssistantInput("");
      assistantRequestKey.current = undefined;
      setAssistantMessage(result.message);
      await invalidateAssistantChanges(
        queryClient,
        contentContext,
        result.changes,
      );
    },
    onError: (error) => setAssistantMessage(errorMessage(error)),
  });
  const topicSuggestionsMutation = useMutation({
    mutationFn: (excludeTopics: string[]) => suggestBookTopics(excludeTopics),
    onSuccess: ({ topics }) => {
      setTopicSuggestions(topics);
      setTopicSuggestionsError(undefined);
    },
    onError: (error) => setTopicSuggestionsError(errorMessage(error)),
  });
  const goalSuggestionsMutation = useMutation({
    mutationFn: ({ topic, excludeGoals }: { topic: string; excludeGoals: string[] }) => suggestBookGoals(topic, excludeGoals),
    onSuccess: ({ goals }) => {
      setGoalSuggestions(goals);
      setGoalSuggestionsError(undefined);
    },
    onError: (error) => setGoalSuggestionsError(errorMessage(error)),
  });
  const extensionPreviewMutation = useMutation({
    mutationFn: ({ bookKey, chapterCount, generation }: { bookKey: string; chapterCount: ExtensionChapterCount; generation: number }) => previewBookExtension(bookKey, chapterCount).then((preview) => ({ ...preview, generation })),
    onSuccess: ({ titles, generation }) => {
      if (generation !== extensionPreviewGeneration.current) return;
      setExtensionTitles(titles);
      setExtensionPreviewReady(true);
      setExtensionError(undefined);
    },
    onError: (error, { generation }) => {
      if (generation !== extensionPreviewGeneration.current) return;
      setExtensionPreviewReady(false);
      setExtensionError(errorMessage(error));
    },
  });
  const extensionMutation = useMutation({
    mutationFn: ({ bookKey, chapterCount, titles, requestKey }: { bookKey: string; chapterCount: ExtensionChapterCount; titles: string[]; requestKey: string }) => extendBook(bookKey, chapterCount, titles, requestKey),
    onMutate: () => setExtensionOpen(false),
    onSuccess: async (book) => {
      patchCachedBookMetadata(queryClient, context, book);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ascendQueryKeys.overview(context), exact: true, refetchType: "active" }),
        queryClient.invalidateQueries({ queryKey: ascendQueryKeys.detail(context, book.key), exact: true, refetchType: "active" }),
      ]);
    },
    onError: async (error, { bookKey }) => {
      showToast({ title: errorMessage(error), duration: 3_000 });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ascendQueryKeys.overview(context), exact: true, refetchType: "active" }),
        queryClient.invalidateQueries({ queryKey: ascendQueryKeys.detail(context, bookKey), exact: true, refetchType: "active" }),
      ]);
    },
  });

  function open(next: LibrarySheet) {
    setSheet(next);
    setSheetOpen(true);
  }
  function closeCreationSheets() {
    setContextPickerOpen(false);
    setCreateDetailsOpen(false);
    setCreateGoalCustomOpen(false);
    setCreateGoalOpen(false);
    setCreateTopicCustomOpen(false);
    setCreateTopicOpen(false);
  }
  function openExtension() {
    extensionPreviewGeneration.current += 1;
    extensionPreviewMutation.reset();
    setExtensionChapterCount(1);
    setExtensionTitles([]);
    setExtensionPreviewReady(false);
    setExtensionError(undefined);
    setSheetOpen(false);
    setSheet(undefined);
    setExtensionOpen(true);
  }
  function closeExtension() {
    extensionPreviewGeneration.current += 1;
    setExtensionOpen(false);
  }
  function chooseExtensionChapterCount(chapterCount: ExtensionChapterCount) {
    extensionPreviewGeneration.current += 1;
    extensionPreviewMutation.reset();
    setExtensionChapterCount(chapterCount);
    setExtensionTitles([]);
    setExtensionPreviewReady(false);
    setExtensionError(undefined);
  }
  function previewExtension() {
    if (!selectedBook || extensionPreviewMutation.isPending) return;
    const generation = ++extensionPreviewGeneration.current;
    setExtensionTitles([]);
    setExtensionPreviewReady(false);
    setExtensionError(undefined);
    extensionPreviewMutation.mutate({ bookKey: selectedBook.key, chapterCount: extensionChapterCount, generation });
  }
  function generateExtension() {
    if (!selectedBook || !extensionPreviewReady || extensionMutation.isPending) return;
    extensionMutation.mutate({ bookKey: selectedBook.key, chapterCount: extensionChapterCount, titles: extensionTitles, requestKey: randomUUID() });
  }
  function beginCreate() {
    closeCreationSheets();
    setDraft(INITIAL_DRAFT);
    setContextLabels({});
    setTopicSuggestions([]);
    setTopicSuggestionsError(undefined);
    setGoalSuggestions([]);
    setDraftError(undefined);
    setSheetOpen(false);
    setSheet(undefined);
    setCreateTopicOpen(true);
    topicSuggestionsMutation.mutate([]);
  }
  function loadNewTopics() {
    setTopicSuggestionsError(undefined);
    topicSuggestionsMutation.mutate(topicSuggestions);
  }
  function briefEditorText(target: BriefEditorTarget) {
    return draft[target];
  }
  function applyBriefEditorText(target: BriefEditorTarget, value: string) {
    setDraft((current) => ({ ...current, [target]: value }));
  }
  function openBriefEditorActions(target: BriefEditorTarget) {
    if (briefTransformation) return;
    setBriefActionTarget(target);
  }
  function openBriefEditorTranslation() {
    if (!briefActionTarget) return;
    if (!briefEditorText(briefActionTarget).trim()) { showToast({ title: "Enter text before using an AI action.", duration: 2_000 }); return; }
    setBriefTargetLanguage(languageForCountryCode(countryCode));
    setBriefTranslateTarget(briefActionTarget);
    setBriefActionTarget(undefined);
  }
  async function transformBriefEditor(target: BriefEditorTarget, action: BriefTransformation["action"]) {
    if (briefTransformation) return;
    const text = briefEditorText(target).trim();
    const language = briefTargetLanguage.trim();
    if (!text) { showToast({ title: "Enter text before using an AI action.", duration: 2_000 }); return; }
    if (action === "translate" && language.length < 2) return;
    const capturedContext = getBooksContext();
    const generation = ++briefTransformationGeneration.current;
    setBriefActionTarget(undefined);
    setBriefTranslateTarget(undefined);
    setBriefTransformation({ target, action });
    try {
      const result = action === "enhance" ? await enhanceAppTextForContext(capturedContext, text) : await translateAppTextForContext(capturedContext, text, language);
      const currentContext = getBooksContext();
      if (generation === briefTransformationGeneration.current && currentContext.organizationKey === capturedContext.organizationKey && currentContext.scopeKey === capturedContext.scopeKey) applyBriefEditorText(target, result.text);
    } catch (error) {
      if (generation === briefTransformationGeneration.current) showToast({ title: errorMessage(error), duration: 2_000 });
    } finally {
      if (generation === briefTransformationGeneration.current) setBriefTransformation(undefined);
    }
  }
  async function openSearchHistory() {
    const key = userSearchHistoryQueryKey(contentContext.userKey);
    const cached = queryClient.getQueryData<ContentSearchHistoryItem[]>(key);
    const invalidated = queryClient.getQueryState(key)?.isInvalidated === true;
    setHistory(cached ?? []);
    setHistoryLoading(!cached || invalidated);
    setHistoryError(undefined);
    setRemovingHistoryQuery(undefined);
    open("searchHistory");
    if (cached && !invalidated) return;
    try {
      setHistory(await getUserSearchHistory(queryClient, contentContext));
    } catch (error) {
      setHistoryError(errorMessage(error));
    } finally {
      setHistoryLoading(false);
    }
  }
  function useHistoryQuery(item: ContentSearchHistoryItem) {
    const promoted = promoteCachedUserSearchHistory(queryClient, contentContext, item);
    setHistory((current) => [promoted, ...current.filter(({ normalizedQuery }) => normalizedQuery !== item.normalizedQuery)]);
    setQuery(item.query);
    setSheetOpen(false);
    setSheet(undefined);
  }
  async function removeHistoryQuery(item: ContentSearchHistoryItem) {
    if (removingHistoryQuery) return;
    const previous = removeCachedUserSearchHistory(queryClient, contentContext, item.normalizedQuery);
    setHistory((current) => current.filter(({ normalizedQuery }) => normalizedQuery !== item.normalizedQuery));
    setRemovingHistoryQuery(item.normalizedQuery);
    setHistoryError(undefined);
    try {
      await deleteContentSearchHistory(item.normalizedQuery);
    } catch (error) {
      queryClient.setQueryData(userSearchHistoryQueryKey(contentContext.userKey), previous);
      setHistory(previous);
      setHistoryError(errorMessage(error));
    } finally {
      setRemovingHistoryQuery(undefined);
    }
  }
  function openGoalStep(topic: string) {
    setDraft((current) => ({ ...current, topic }));
    setGoalSuggestions([]);
    setGoalSuggestionsError(undefined);
    setDraftError(undefined);
    Keyboard.dismiss();
    setCreateGoalOpen(true);
    goalSuggestionsMutation.mutate({ topic, excludeGoals: [] });
  }
  function loadNewGoals() {
    setGoalSuggestionsError(undefined);
    goalSuggestionsMutation.mutate({ topic: draft.topic, excludeGoals: goalSuggestions });
  }
  function openDetailsStep(goal: string) {
    setDraft((current) => ({ ...current, goal }));
    setDraftError(undefined);
    Keyboard.dismiss();
    setCreateDetailsOpen(true);
  }
  function submit() {
    if (createMutation.isPending) return;
    if (
      draft.topic.trim().length < 3 ||
      draft.goal.trim().length < 3
    ) {
      setDraftError(
        "Complete the topic and goal before creating your audio book.",
      );
      return;
    }
    if (draft.archiveDocumentKeys.length > MAX_CONTEXT_DOCUMENTS) {
      setDraftError(
        `Choose no more than ${MAX_CONTEXT_DOCUMENTS} Archive documents.`,
      );
      return;
    }
    const input = {
      ...draft,
      currentKnowledge: "",
      narratorVoiceKey: DEFAULT_NARRATOR.key,
      narrationPace: 1,
      additionalInstructions: undefined,
    };
    const requestKey = retryBookCreateRequestKey(failedCreate.current, input, randomUUID);
    setDraftError(undefined);
    closeCreationSheets();
    setDraft(INITIAL_DRAFT);
    createMutation.mutate({ input, requestKey });
  }
  function chooseBook(book: Book) {
    setRevealedChapterCount(0);
    setSelectedBookKey(book.key);
    setBookPageOpen(true);
    setSheetOpen(false);
    setSheet(undefined);
  }
  function toggleBookSelection(bookKey: string) {
    setSelectedBookKeys((current) => current.includes(bookKey) ? current.filter((key) => key !== bookKey) : [...current, bookKey]);
  }
  function handleBookLongPress(bookKey: string) {
    longPressedBook.current = bookKey;
    toggleBookSelection(bookKey);
    void Haptics.selectionAsync();
    requestAnimationFrame(() => {
      if (longPressedBook.current === bookKey) longPressedBook.current = undefined;
    });
  }
  function handleBookPress(book: Book) {
    if (longPressedBook.current === book.key) {
      longPressedBook.current = undefined;
      return;
    }
    if (selectionActive) toggleBookSelection(book.key);
    else chooseBook(book);
  }
  async function updateBooksFavorite(targets: readonly Book[], isFavorite: boolean, bulk: boolean) {
    if (!targets.length || bulkMutationLocked.current) return;
    bulkMutationLocked.current = true;
    setBulkLoading(true);
    setLifecycleError(undefined);
    const results = await Promise.allSettled(targets.map((book) => setBookFavorite(book.key, isFavorite)));
    const failedKeys: string[] = [];
    results.forEach((result, index) => {
      if (result.status === "fulfilled") patchCachedBook(queryClient, context, result.value);
      else failedKeys.push(targets[index]!.key);
    });
    setBulkLoading(false);
    bulkMutationLocked.current = false;
    if (bulk) setSelectedBookKeys(failedKeys);
    if (!failedKeys.length) {
      setSheetOpen(false);
      setSheet(undefined);
      showToast({ title: `${targets.length} ${targets.length === 1 ? "audio book" : "audio books"} ${isFavorite ? "favorited" : "unfavorited"}`, duration: 2_000 });
      return;
    }
    const message = failedKeys.length === targets.length ? "Favorites could not be updated." : `${targets.length - failedKeys.length} updated, ${failedKeys.length} failed`;
    setLifecycleError(message);
    showToast({ title: message, duration: 2_500 });
  }
  async function deleteSelectedBooks() {
    if (!selectedBooks.length || bulkMutationLocked.current) return;
    bulkMutationLocked.current = true;
    setBulkLoading(true);
    setLifecycleError(undefined);
    const favorites = selectedBooks.filter(({ isFavorite }) => isFavorite);
    const eligible = selectedBooks.filter(({ isFavorite }) => !isFavorite);
    const results = await Promise.allSettled(eligible.map(async (book) => {
      await deleteBook(book.key, randomUUID());
      return book;
    }));
    const staleFavorites = results.flatMap((result, index) => result.status === "rejected" && result.reason instanceof BookClientError && result.reason.code === "BOOK_FAVORITE" ? [{ ...eligible[index]!, isFavorite: true }] : []);
    const failedKeys = results.flatMap((result, index) => result.status === "rejected" && !(result.reason instanceof BookClientError && result.reason.code === "BOOK_FAVORITE") ? [eligible[index]!.key] : []);
    const firstFailure = results.find((result) => result.status === "rejected" && !(result.reason instanceof BookClientError && result.reason.code === "BOOK_FAVORITE"));
    const failureMessage = firstFailure?.status === "rejected" && firstFailure.reason instanceof Error ? firstFailure.reason.message : undefined;
    results.forEach((result) => {
      if (result.status === "fulfilled") {
        removeCachedBook(queryClient, context, result.value.key);
        if (playback.playbackBookKey === result.value.key) playback.clear(false);
      }
    });
    staleFavorites.forEach((book) => patchCachedBook(queryClient, context, book));
    const retainedFavorites = [...favorites, ...staleFavorites];
    setSelectedBookKeys([...retainedFavorites.map(({ key }) => key), ...failedKeys]);
    setBulkLoading(false);
    bulkMutationLocked.current = false;
    setSheetOpen(false);
    setSheet(undefined);
    if (retainedFavorites.length) showToast({ title: `Can't delete ${retainedFavorites.length} favorite audio book${retainedFavorites.length === 1 ? "" : "s"}`, duration: 2_500 });
    else if (failedKeys.length) {
      setLifecycleError(failureMessage ?? `${eligible.length - failedKeys.length} deleted, ${failedKeys.length} failed`);
      showToast({ title: failureMessage ?? `${eligible.length - failedKeys.length} deleted, ${failedKeys.length} failed`, duration: 4_000 });
    }
    else showToast({ title: `${eligible.length} ${eligible.length === 1 ? "audio book" : "audio books"} deleted`, duration: 2_000 });
  }
  function deleteSelectedBook() {
    if (!selectedBook) return;
    if (selectedBook.isFavorite) {
      setSheetOpen(false);
      setSheet(undefined);
      showToast({ title: "Can't delete favorite audio book", duration: 2_500 });
      return;
    }
    lifecycleMutation.mutate({ action: "delete", book: selectedBook });
  }
  function openChapterSummary(chapterKey: string) {
    setReaderChapterKey(chapterKey);
    open("reader");
  }
  function finishContextSelection(selection: EmailAttachmentRef[], labels: EmailAttachmentLabels) {
    setDraft((current) => ({ ...current, archiveDocumentKeys: selection.filter(({ type }) => type === "document").map(({ key }) => key) }));
    setContextLabels(labels);
    setContextPickerOpen(false);
    setDraftError(undefined);
  }
  function removeAllContext() {
    setDraft((current) => ({ ...current, archiveDocumentKeys: [] }));
    setContextLabels({});
  }
  function askAssistant() {
    const message = assistantInput.trim();
    if (!message) return;
    assistantRequestKey.current ??= randomUUID();
    assistantMutation.mutate({
      message,
      requestKey: assistantRequestKey.current,
    });
  }

  useEffect(() => {
    if (!playback.readerRequest || !playback.playbackBookKey) return;
    const frame = requestAnimationFrame(() => {
      setRevealedChapterCount(0);
      setSelectedBookKey(playback.playbackBookKey);
      setReaderChapterKey(playback.chapter?.key);
      setBookPageOpen(true);
      setSheet("reader");
      setSheetOpen(true);
    });
    return () => cancelAnimationFrame(frame);
  }, [playback.chapter?.key, playback.playbackBookKey, playback.readerRequest]);

  const orderedChapters = [...(detail?.chapters ?? [])].sort((left, right) => left.position - right.position);
  const readerChapter = orderedChapters.find(({ key }) => key === readerChapterKey) ?? playback.chapter;
  const readableChapters = orderedChapters.filter(({ content }) => Boolean(content));
  const readingChapter = readableChapters.find(({ key }) => key === readingChapterKey);
  const bookReadingChapter =
    readableChapters.find(({ key }) => key === detail?.book.currentChapterKey) ??
    readableChapters.find(({ isCompleted }) => !isCompleted) ??
    readableChapters[0];
  function openChapterReading(chapterKey?: string) {
    const chapter = readableChapters.find(({ key }) => key === chapterKey) ?? bookReadingChapter;
    if (!chapter) {
      showToast({ title: "Full chapter text is not available yet.", duration: 2_500 });
      return;
    }
    setReadingChapterKey(chapter.key);
    setSheet("chapterRead");
    setSheetOpen(true);
  }
  function stepReadingChapter(offset: -1 | 1) {
    if (!readingChapter || readableChapters.length < 2) return;
    const index = readableChapters.findIndex(({ key }) => key === readingChapter.key);
    setReadingChapterKey(readableChapters[(index + offset + readableChapters.length) % readableChapters.length]!.key);
  }
  function closeContentSheet() {
    setSheetOpen(false);
    setSheet(undefined);
    setReaderChapterKey(undefined);
    setReadingChapterKey(undefined);
  }
  const playableChapters = orderedChapters.filter((chapter) => chapter.content && chapter.audioUrl);
  const bookTimeline = playableChapters.map((chapter) => ({ durationMs: (chapter.audioDurationSeconds ?? (chapter.estimatedMinutes ?? 0) * 60) * 1_000 }));
  const bookDuration = audioTimelineDuration(bookTimeline);
  const fallbackPlaybackChapter =
    playableChapters.find(({ key }) => key === detail?.book.currentChapterKey) ??
    playableChapters.find(({ isCompleted }) => !isCompleted) ??
    playableChapters[0];
  const playbackMatchesBook = playback.playbackBookKey === detail?.book.key;
  const islandChapter = playbackMatchesBook ? playback.chapter ?? fallbackPlaybackChapter : fallbackPlaybackChapter;
  const islandChapterIndex = playableChapters.findIndex(({ key }) => key === islandChapter?.key);
  const bookPlaybackPosition = islandChapterIndex < 0 ? 0 : audioTimelinePosition(bookTimeline, islandChapterIndex, playbackMatchesBook ? playback.currentTime : islandChapter?.progressSeconds ?? 0);
  const islandElapsed = playbackScrubValue ?? bookPlaybackPosition;
  const islandPlaying = playbackMatchesBook && playback.audio.playing;
  const islandError = playbackMatchesBook ? playback.error ?? playback.persistenceError ?? playback.refreshWarning : undefined;
  useEffect(() => {
    setPlaybackIslandDismissed(false);
    setPlaybackScrubValue(undefined);
  }, [bookPageOpen, selectedBookKey]);
  useEffect(() => {
    if (playbackScrubValue === undefined || Math.abs(bookPlaybackPosition - playbackScrubValue) > 0.75) return;
    const timeout = setTimeout(() => setPlaybackScrubValue(undefined), 0);
    return () => clearTimeout(timeout);
  }, [bookPlaybackPosition, playbackScrubValue]);
  const bookPlaybackIsland = bookPageOpen && detail && islandChapter && !playbackIslandDismissed ? (
    <View style={styles.narrationPlayer}>
      <View style={styles.narrationHeading}>
        <View style={styles.narrationTitleBlock}><Text numberOfLines={1} style={styles.narrationTitle}>{islandChapter.title}</Text></View>
        <Button accessibilityLabel="Close audio player" contentMode="raw" onPress={() => { setPlaybackIslandDismissed(true); if (playbackMatchesBook) playback.clear(); }} size="xs" variant="icon"><CloseIcon size="sm" /></Button>
      </View>
      <View style={styles.narrationControls}>
        <Button accessibilityLabel={islandPlaying ? "Pause listening" : "Play audio"} contentMode="raw" loading={playback.refreshingUrl} onPress={() => { if (playbackMatchesBook && playback.chapter) void playback.toggle(); else void playback.playBookChapter(detail.book.key, islandChapter.key, true); }} size="sm" variant="icon">{islandPlaying ? <PauseIcon size="sm" /> : <PlayIcon size="sm" />}</Button>
        <Text style={styles.narrationTime}>{formatAudioTime(islandElapsed)}</Text>
        <Slider accessibilityLabel="Audio book progress" disabled={bookDuration <= 0} max={Math.max(1, bookDuration)} onSlidingComplete={(value) => { setPlaybackScrubValue(value); const destination = resolveAudioTimelinePosition(bookTimeline, value); const destinationChapter = playableChapters[destination.index]; if (!destinationChapter) return; if (playbackMatchesBook && playback.chapter?.key === destinationChapter.key) void playback.seek(destination.seconds); else void playback.playBookChapter(detail.book.key, destinationChapter.key, islandPlaying, destination.seconds); }} onValueChange={setPlaybackScrubValue} style={styles.narrationSlider} value={Math.min(islandElapsed, bookDuration)} />
        <Text style={styles.narrationTime}>{formatAudioTime(bookDuration)}</Text>
      </View>
      {islandError ? <Text accessibilityRole="alert" numberOfLines={2} style={styles.narrationError}>{islandError}</Text> : null}
    </View>
  ) : undefined;
  useEffect(() => {
    if (reducedChapterMotion || revealedChapterCount >= orderedChapters.length) return;
    const timer = setTimeout(() => setRevealedChapterCount((current) => Math.min(current + 1, orderedChapters.length)), 110);
    return () => clearTimeout(timer);
  }, [orderedChapters.length, reducedChapterMotion, revealedChapterCount]);
  const visibleChapterCount = reducedChapterMotion ? orderedChapters.length : revealedChapterCount;
  const revealedChapters = orderedChapters.slice(0, visibleChapterCount);
  const showNextChapterSkeleton = Boolean(detail) && (
    visibleChapterCount < orderedChapters.length ||
    ACTIVE_STATUSES.includes(detail!.book.status) && orderedChapters.length < detail!.book.chapterCount
  );
  const sheetTitle =
    sheet === "actions"
      ? ""
      : sheet === "filter"
        ? "Filter audio books"
        : sheet === "reader"
          ? "Audio book chapter"
          : sheet === "chapterRead"
            ? "Audio book chapter"
          : sheet === "bookSummary"
            ? "Audio book"
          : sheet === "delete"
            ? "Delete audio book?"
            : sheet === "bulkDelete"
              ? `Delete ${selectedBooks.length} ${selectedBooks.length === 1 ? "audio book" : "audio books"}?`
              : (selectedBook?.title ?? "Audio book");
  const sheetFooter = sheet === "chapterRead" ? (
    <View style={styles.chapterReadingFooter}>
      <View style={styles.chapterReadingSteps}>
        <Button accessibilityLabel="Previous chapter" contentMode="raw" disabled={readableChapters.length < 2} onPress={() => stepReadingChapter(-1)} size="md" variant="icon"><ChevronLeftIcon size="sm" /></Button>
        <Button accessibilityLabel="Next chapter" contentMode="raw" disabled={readableChapters.length < 2} onPress={() => stepReadingChapter(1)} size="md" variant="icon"><ChevronRightIcon size="sm" /></Button>
      </View>
      <Button onPress={closeContentSheet} size="md" variant="secondary">Close</Button>
    </View>
  ) : sheet === "reader" ? <><Button disabled={!readerChapter?.content} onPress={() => openChapterReading(readerChapter?.key)} size="md" variant="primary">Read</Button><Button onPress={closeContentSheet} size="md" variant="secondary">Close</Button></>
    : sheet === "bookSummary" ? <><Button disabled={!bookReadingChapter} onPress={() => openChapterReading(bookReadingChapter?.key)} size="md" variant="primary">Read</Button><Button onPress={closeContentSheet} size="md" variant="secondary">Close</Button></>
      : undefined;
  return (
    <KeyboardAvoidingView behavior={aiInputFocused ? "height" : undefined} style={styles.root}>
      <View
        style={[
          styles.globalHeader,
          {
            paddingTop: insets.top + 6,
            paddingLeft: Math.max(insets.left, spacing.md),
            paddingRight: Math.max(insets.right, spacing.md),
          },
        ]}
      >
        <WorkspaceAppSwitcher
          active="ascend"
          onBeforeSelect={() =>
            !(creating && dirty)
          }
        />
      </View>
      <View style={styles.localHeader}>
        {bookPageOpen ? <Button accessibilityLabel="Back to audio books" contentMode="raw" onPress={() => { setBookPageOpen(false); setSelectedBookKey(undefined); }} size="xs" variant="icon"><ChevronLeftIcon size="sm" /></Button> : <WorkspaceAppSwitcher active="ascend" trigger="back" />}
        <Text numberOfLines={1} style={styles.localTitle}>{bookPageOpen ? selectedBook?.title ?? "Audio book" : "Ascend"}</Text>
        {bookPageOpen ? <Button accessibilityLabel="Audio book actions" contentMode="raw" disabled={!selectedBook} onPress={() => open("bookActions")} size="xs" variant="icon"><MoreHorizontalIcon size="sm" /></Button> : <Button accessibilityLabel="Create in Ascend" contentMode="raw" onPress={() => open("actions")} size="xs" variant="icon"><PlusIcon size="sm" /></Button>}
      </View>
      {bookPageOpen ? (
        detailQuery.isPending ? <View accessibilityRole="progressbar" style={[styles.detailLoading, styles.detailPage]}><Skeleton style={styles.detailCoverSkeleton} /><Skeleton style={styles.detailLine} /><Skeleton style={[styles.chapterSkeleton, { width: chapterWidth, height: (chapterWidth * 16) / 9 }]} /></View> : detail ? (
          <ScrollView contentContainerStyle={[styles.detail, styles.detailPage]} showsVerticalScrollIndicator={false}>
            <Button accessibilityLabel={`About ${detail.book.title}`} contentMode="raw" onPress={() => open("bookSummary")} shape="rounded" size="md" style={styles.detailHero} variant="ghost">
              <View style={styles.detailCover}><Cover book={detail.book} /></View>
              <View style={styles.detailCopy}>
                {detail.book.currentChapterKey ? <><Text style={styles.detailCurrentLabel}>CURRENT CHAPTER</Text><Text style={styles.detailCurrentChapter}>{orderedChapters.find(({ key }) => key === detail.book.currentChapterKey)?.title ?? detail.book.title}</Text></> : null}
                <Text style={styles.detailDuration}>{formatBookDuration((bookDuration || detail.book.estimatedMinutes * 60) / 60)}</Text>
              </View>
            </Button>
            <View onLayout={({ nativeEvent }) => setChapterGridWidth(nativeEvent.layout.width)} style={styles.grid}>
              {revealedChapters.map((chapter) => <ChapterCard chapter={chapter} key={chapter.key} onPress={() => openChapterSummary(chapter.key)} reducedMotion={reducedChapterMotion} width={chapterWidth} />)}
              {showNextChapterSkeleton ? <Skeleton accessibilityLabel={`Preparing chapter ${visibleChapterCount + 1}`} accessibilityRole="progressbar" style={[styles.chapterSkeleton, { width: chapterWidth, height: (chapterWidth * 16) / 9 }]} /> : null}
            </View>
          </ScrollView>
        ) : <View accessibilityRole="alert" style={styles.state}><Text style={styles.stateTitle}>Audio book details could not be loaded.</Text><Button onPress={() => void detailQuery.refetch()} size="sm" variant="secondary">Retry</Button></View>
      ) : <>
        <View style={styles.searchRow}>
          <View style={styles.rootSearch}><SearchIcon size="sm" variant="muted" /><TextInput accessibilityLabel="Search audio books" editable={rootSearchFocusable} focusable={rootSearchFocusable} onChangeText={setQuery} placeholder="Search..." ref={rootSearchInputRef} style={styles.rootSearchInput} value={query} />{query ? <Button accessibilityLabel="Clear audio book search" contentMode="raw" iconOnly onPress={() => setQuery("")} size="xs" variant="secondary"><CloseIcon size="sm" /></Button> : null}</View>
          <Button accessibilityLabel="Filter audio books" contentMode="raw" onPress={() => open("filter")} size="sm" style={styles.searchHistoryButton} variant="icon"><FilterIcon size="sm" variant={showOnlyFavorites ? "accent" : "default"} /></Button>
        </View>
        {selectionActive ? <Tabs accessibilityLabel="Selected audio book toolbar" style={styles.bulkToolbar}>
          <View style={styles.bulkToolbarSelection}>
            <Button accessibilityLabel="Clear selection" contentMode="raw" disabled={bulkLoading} onPress={() => setSelectedBookKeys([])} size="xs" style={styles.bulkToolbarClose} variant="secondary"><CloseIcon size="sm" /></Button>
            <Text accessibilityLiveRegion="polite" style={styles.bulkSelectionText}>{selectedBooks.length} selected</Text>
          </View>
          <Button accessibilityLabel="Selected audio book actions" contentMode="raw" disabled={bulkLoading} onPress={() => open("bulkActions")} size="xs" variant="icon"><MoreHorizontalIcon size="sm" /></Button>
        </Tabs> : null}
        <ScrollView contentContainerStyle={styles.library} showsVerticalScrollIndicator={false}>
          {overviewQuery.isPending ? <View accessibilityLabel="Loading audio books" accessibilityRole="progressbar" onLayout={({ nativeEvent }) => setGridWidth(nativeEvent.layout.width)} style={styles.grid}>{Array.from({ length: COLUMNS }, (_, index) => <Skeleton key={index} style={{ width: cardWidth, height: (cardWidth * 16) / 9, borderRadius: radii.sm }} />)}</View> : overviewQuery.error ? <View style={styles.state}><Text style={styles.stateTitle}>Audio books could not be loaded.</Text><Button onPress={() => void overviewQuery.refetch()} size="sm" variant="secondary">Retry</Button></View> : (
            <View onLayout={({ nativeEvent }) => setGridWidth(nativeEvent.layout.width)} style={styles.grid}>
              {filteredBooks.map((book, index) => {
                if (book.key.startsWith("pending-")) return <Skeleton accessibilityLabel={`Preparing ${book.title}`} accessibilityRole="progressbar" key={book.key} style={{ width: cardWidth, height: (cardWidth * 16) / 9, borderRadius: radii.sm }} />;
                const selected = selectedBookKeys.includes(book.key);
                return <View key={book.key} style={[styles.bookCardFrame, selected && styles.selectedItem, { width: cardWidth, height: (cardWidth * 16) / 9 }]}><Button accessibilityActions={[{ name: "longpress", label: selected ? `Deselect ${book.title}` : `Select ${book.title}` }]} accessibilityLabel={book.title} accessibilityRole="button" accessibilityState={{ selected }} contentMode="raw" onAccessibilityAction={({ nativeEvent }) => { if (nativeEvent.actionName === "longpress") handleBookLongPress(book.key); }} onLongPress={() => handleBookLongPress(book.key)} onPress={() => handleBookPress(book)} shape="rounded" size="md" style={styles.bookCard} variant="ghost"><Cover book={book} index={index} /><LinearGradient colors={["transparent", "rgba(0,0,0,0.08)", "rgba(0,0,0,0.58)"]} locations={[0, 0.58, 1]} style={styles.cardShade} /><View style={styles.cardCopy}><Text numberOfLines={3} style={styles.cardTitle}>{book.title}</Text></View></Button>{selected ? <View pointerEvents="none" style={styles.selectionBadge}><CheckIcon size="sm" variant="inverse" /></View> : null}</View>;
              })}
            </View>
          )}
          {!overviewQuery.isPending && !overviewQuery.error && filteredBooks.length === 0 ? <View style={styles.state}><Text style={styles.stateTitle}>{query.trim() ? "No audio books matched this search." : showOnlyFavorites ? "No favorite audio books." : books.length ? "No audio books match this view." : "No audio books yet."}</Text>{!books.length && !query.trim() && !showOnlyFavorites ? <Button accessibilityLabel="Create audio book" contentMode="raw" onPress={beginCreate} size="md" style={styles.emptyPlusButton} variant="icon"><PlusIcon size="sm" /></Button> : null}</View> : null}
        </ScrollView>
      </>}
      <CoreComposer
        accessibilityLabel="Ask Core about Ascend"
        accessory={bookPlaybackIsland}
        disabled={assistantMutation.isPending}
        editable={!assistantMutation.isPending}
        leading={
          <ChromeIcon glow={0.35} size={24} source={assistantIconSource} />
        }
        loading={assistantMutation.isPending}
        maxLength={8_000}
        message={
          assistantMessage ? (
            <View style={styles.coreMessage}>
              <Text style={styles.noticeText}>{assistantMessage}</Text>
            </View>
          ) : null
        }
        onChangeText={(value) => {
          setAssistantInput(value);
          assistantRequestKey.current = undefined;
        }}
        onFocusChange={(focused) => {
          if (rootSearchFocusTimer.current) clearTimeout(rootSearchFocusTimer.current);
          rootSearchInputRef.current?.blur();
          Keyboard.dismiss();
          setRootSearchFocusable(false);
          if (!focused) {
            rootSearchFocusTimer.current = setTimeout(() => {
              rootSearchInputRef.current?.blur();
              Keyboard.dismiss();
              setRootSearchFocusable(true);
            }, 300);
          }
          setAiInputFocused(focused);
          if (!focused) setAssistantMessage(undefined);
        }}
        onSubmit={askAssistant}
        prompts={CORE_PROMPTS}
        sendIcon={<SendIcon size="sm" />}
        value={assistantInput}
      />

      <SearchHistorySheet error={historyError} history={history} loading={historyLoading} onClose={() => { setSheetOpen(false); setSheet(undefined); }} onRemove={(item) => void removeHistoryQuery(item)} onSelect={useHistoryQuery} open={sheetOpen && sheet === "searchHistory"} removingQuery={removingHistoryQuery} />

      <BottomSheet
        description={sheet === "reader" ? readerChapter?.title : sheet === "chapterRead" ? readingChapter?.title : sheet === "bookSummary" ? detail?.book.title : undefined}
        dismissible={!bulkLoading && !lifecycleMutation.isPending}
        footer={sheetFooter}
        height={sheet === "reader" || sheet === "chapterRead" || sheet === "bookSummary" ? "full" : undefined}
        hideHeading={sheet === "actions" || sheet === "filter" || sheet === "bookActions" || sheet === "bulkActions"}
        onOpenChange={(next) => {
          setSheetOpen(next);
          if (!next) { setSheet(undefined); setReaderChapterKey(undefined); setReadingChapterKey(undefined); }
        }}
        onSwipeLeft={sheet === "chapterRead" ? () => stepReadingChapter(1) : undefined}
        onSwipeRight={sheet === "chapterRead" ? () => stepReadingChapter(-1) : undefined}
        open={sheetOpen && sheet !== "searchHistory"}
        pageKey={sheet === "chapterRead" ? `${sheet}:${readingChapterKey ?? "none"}` : sheet}
        title={sheetTitle}
      >
        {sheet === "actions" ? (
          <BottomSheetItem
            onPress={beginCreate}
            style={styles.sheetAction}
            variant="secondary"
          >
            Create audio book
          </BottomSheetItem>
        ) : null}
        {sheet === "filter" ? (
          <View style={styles.filterPanel}>
            <View style={styles.favoriteSwitchRow}>
              <Switch accessibilityLabel="Show only favorite audio books" checked={showOnlyFavorites} onCheckedChange={(checked) => { setShowOnlyFavorites(checked); setSheetOpen(false); setSheet(undefined); }} />
              <Text style={styles.favoriteSwitchLabel}>Favorites</Text>
            </View>
            <Button onPress={() => void openSearchHistory()} size="md" style={styles.searchHistoryOption} variant="secondary">Search history</Button>
          </View>
        ) : null}
        {sheet === "bookActions" && selectedBook ? (
          <View style={styles.sheetList}>
            {lifecycleError ? (
              <Text accessibilityRole="alert" style={styles.failed}>
                {lifecycleError}
              </Text>
            ) : null}
            <BottomSheetItem disabled={bulkLoading || selectedBook.key.startsWith("pending-")} onPress={() => void updateBooksFavorite([selectedBook], !selectedBook.isFavorite, false)} style={styles.sheetAction} variant="secondary">{selectedBook.isFavorite ? "Unfavorite" : "Favorite"}</BottomSheetItem>
            <BottomSheetItem disabled={selectedBook.key.startsWith("pending-")} onPress={() => { setSheetOpen(false); setSheet(undefined); setSharingBook(selectedBook); }} style={styles.sheetAction} variant="secondary">Share</BottomSheetItem>
            {selectedBook.status === "ready" ? <BottomSheetItem disabled={extensionMutation.isPending} onPress={openExtension} style={styles.sheetAction} variant="secondary">Extend</BottomSheetItem> : null}
            {selectedBook.status === "failed" || selectedBook.status === "cancelled" ? (
              <BottomSheetItem
                disabled={
                  lifecycleMutation.isPending ||
                  selectedBook.key.startsWith("pending-")
                }
                onPress={() =>
                  lifecycleMutation.mutate({
                    action: "retry",
                    book: selectedBook,
                  })
                }
                style={styles.sheetAction}
                variant="secondary"
              >
                Retry generation
              </BottomSheetItem>
            ) : null}
            {ACTIVE_STATUSES.includes(selectedBook.status) ? (
              <BottomSheetItem
                disabled={
                  lifecycleMutation.isPending ||
                  selectedBook.key.startsWith("pending-")
                }
                onPress={() =>
                  lifecycleMutation.mutate({
                    action: "cancel",
                    book: selectedBook,
                  })
                }
                style={styles.sheetAction}
                variant="secondary"
              >
                Cancel generation
              </BottomSheetItem>
            ) : null}
            <BottomSheetItem
              disabled={
                lifecycleMutation.isPending ||
                selectedBook.key.startsWith("pending-")
              }
              onPress={() => setSheet("delete")}
              style={styles.sheetAction}
              variant="secondary"
            >
              Delete
            </BottomSheetItem>
          </View>
        ) : null}
        {sheet === "bulkActions" ? <View style={styles.bulkActionList}>
          <Button disabled={bulkLoading} loading={bulkLoading} onPress={() => void updateBooksFavorite(selectedBooks, !allSelectedFavorite, true)} size="md" variant="secondary">{allSelectedFavorite ? "Unfavorite" : "Favorite"}</Button>
          <Button disabled={bulkLoading} onPress={() => setSheet("bulkDelete")} size="md" variant="secondary">Delete</Button>
        </View> : null}
        {sheet === "bulkDelete" ? <View style={styles.compactSheetActions}>
          <Button disabled={bulkLoading} loading={bulkLoading} onPress={() => void deleteSelectedBooks()} size="md" variant="primary">Delete</Button>
          <Button disabled={bulkLoading} onPress={() => { setSheetOpen(false); setSheet(undefined); }} size="md" variant="secondary">Close</Button>
        </View> : null}
        {sheet === "delete" && selectedBook ? (
          <View style={styles.compactSheetActions}>
            <Button
              disabled={lifecycleMutation.isPending}
              loading={lifecycleMutation.isPending}
              onPress={deleteSelectedBook}
              size="md"
              variant="primary"
            >
              Delete
            </Button>
            <Button
              disabled={lifecycleMutation.isPending}
              onPress={() => { setSheetOpen(false); setSheet(undefined); }}
              size="md"
              variant="secondary"
            >
              Close
            </Button>
          </View>
        ) : null}
        {sheet === "reader" ? <View style={styles.summarySheetContent}><Reader chapter={readerChapter} /></View> : null}
        {sheet === "chapterRead" ? <ChapterReading chapter={readingChapter} /> : null}
        {sheet === "bookSummary" ? <View style={styles.summarySheetContent}><View style={styles.chapterSummaryPanel}><Text selectable style={styles.chapterSummaryText}>{detail?.book.description || "A description is unavailable for this audio book."}</Text></View></View> : null}
      </BottomSheet>

      <BottomSheet
        dismissible={!extensionPreviewMutation.isPending}
        footer={<><Button disabled={extensionPreviewMutation.isPending || extensionMutation.isPending} loading={extensionPreviewMutation.isPending} onPress={extensionPreviewReady ? generateExtension : previewExtension} size="md" variant="primary">{extensionPreviewReady ? "Generate" : "Preview"}</Button><Button disabled={extensionMutation.isPending} onPress={closeExtension} size="md" variant="secondary">Close</Button></>}
        height="full"
        onOpenChange={(open) => { if (!open) closeExtension(); }}
        open={extensionOpen}
        title="Extend audio book"
      >
        <View style={styles.extensionStep}>
          <Text style={styles.formLabel}>New chapters</Text>
          <Tabs accessibilityLabel="Extension chapter count" accessibilityRole="tablist" style={styles.detailTabs}>
            {EXTENSION_CHAPTER_OPTIONS.map((count) => <Button accessibilityRole="tab" accessibilityState={{ selected: extensionChapterCount === count }} key={count} onPress={() => chooseExtensionChapterCount(count)} size="md" style={styles.detailTab} variant={extensionChapterCount === count ? "secondary" : "ghost"}>{count}</Button>)}
          </Tabs>
          <ScrollView accessibilityLiveRegion="polite" accessibilityState={{ busy: extensionPreviewMutation.isPending }} contentContainerStyle={styles.extensionTitles} showsVerticalScrollIndicator={false}>
            {extensionPreviewMutation.isPending ? Array.from({ length: extensionChapterCount }, (_, index) => <Skeleton accessibilityLabel="Previewing extension chapters" accessibilityRole="progressbar" key={index} style={styles.extensionTitleSkeleton} />) : extensionTitles.map((title, index) => <ActionPill key={`${index}-${title}`}><Text numberOfLines={2} style={styles.extensionTitle}>{title}</Text></ActionPill>)}
            {extensionError ? <Text accessibilityRole="alert" style={styles.failed}>{extensionError}</Text> : null}
          </ScrollView>
        </View>
      </BottomSheet>

      <BottomSheet
        dismissible={!topicSuggestionsMutation.isPending}
        footer={<><Button disabled={topicSuggestionsMutation.isPending} onPress={loadNewTopics} size="md" variant="primary">New topics</Button><Button onPress={closeCreationSheets} size="md" variant="secondary">Close</Button></>}
        height="full"
        onOpenChange={(open) => { if (!open && !createTopicCustomOpen && !createGoalOpen) closeCreationSheets(); }}
        open={createTopicOpen}
        title="Choose a topic"
      >
        <ScrollView contentContainerStyle={styles.suggestionStep} showsVerticalScrollIndicator={false}>
          <View style={styles.suggestionList}>
            {!topicSuggestionsMutation.isPending && topicSuggestions.length ? <Button onPress={() => setCreateTopicCustomOpen(true)} shape="pill" size="md" style={styles.suggestionPill} variant="secondary">Custom</Button> : null}
            {topicSuggestionsMutation.isPending ? Array.from({ length: 3 }, (_, index) => <Skeleton key={index} style={styles.suggestionLoadingPill} />) : topicSuggestions.map((topic) => <Button contentMode="raw" key={topic} onPress={() => openGoalStep(topic)} shape="pill" size="md" style={styles.suggestionPill} variant="secondary"><Text numberOfLines={1} style={styles.suggestionText}>{topic}</Text></Button>)}
          </View>
          {topicSuggestionsError ? <Text accessibilityRole="alert" style={styles.noticeText}>{topicSuggestionsError}</Text> : null}
        </ScrollView>
      </BottomSheet>

      <BottomSheet
        dismissible={!briefTransformation}
        footer={<><Button disabled={Boolean(briefTransformation) || draft.topic.trim().length < 3} onPress={() => openGoalStep(draft.topic.trim())} size="md" variant="primary">Next</Button><Button disabled={Boolean(briefTransformation)} onPress={() => setCreateTopicCustomOpen(false)} size="md" variant="secondary">Close</Button></>}
        height="full"
        onOpenChange={(open) => { if (!open && !createGoalOpen) setCreateTopicCustomOpen(false); }}
        open={createTopicCustomOpen}
        title="Your topic"
      >
        <View style={styles.customStep}>
          <Text style={styles.inputLabel}>Topic</Text>
          <AiTextEditor accessibilityLabel="Audio book topic" autoFocus editable={briefTransformation?.target !== "topic"} maxLength={2_000} multiline onChangeText={(topic) => setDraft((current) => ({ ...current, topic }))} onOpenActions={() => openBriefEditorActions("topic")} placeholder="What should this audio book explore?" style={styles.customTextArea} textAlignVertical="top" transformation={briefTransformation?.target === "topic" ? briefTransformation.action : undefined} value={draft.topic} />
        </View>
      </BottomSheet>

      <BottomSheet
        dismissible={!goalSuggestionsMutation.isPending}
        footer={<><Button disabled={goalSuggestionsMutation.isPending} onPress={loadNewGoals} size="md" variant="primary">New goals</Button><Button onPress={() => setCreateGoalOpen(false)} size="md" variant="secondary">Close</Button></>}
        height="full"
        onOpenChange={(open) => { if (!open && !createGoalCustomOpen && !createDetailsOpen) setCreateGoalOpen(false); }}
        open={createGoalOpen}
        title="Choose a goal"
      >
        <ScrollView contentContainerStyle={styles.suggestionStep} showsVerticalScrollIndicator={false}>
          <View style={styles.suggestionList}>
            {!goalSuggestionsMutation.isPending && goalSuggestions.length ? <Button onPress={() => setCreateGoalCustomOpen(true)} shape="pill" size="md" style={styles.suggestionPill} variant="secondary">Custom</Button> : null}
            {goalSuggestionsMutation.isPending ? Array.from({ length: 3 }, (_, index) => <Skeleton key={index} style={styles.suggestionLoadingPill} />) : goalSuggestions.map((goal) => <Button contentMode="raw" key={goal} onPress={() => openDetailsStep(goal)} shape="pill" size="md" style={styles.suggestionPill} variant="secondary"><Text numberOfLines={1} style={styles.suggestionText}>{goal}</Text></Button>)}
          </View>
          {goalSuggestionsError ? <Text accessibilityRole="alert" style={styles.noticeText}>{goalSuggestionsError}</Text> : null}
        </ScrollView>
      </BottomSheet>

      <BottomSheet
        dismissible={!briefTransformation}
        footer={<><Button disabled={Boolean(briefTransformation) || draft.goal.trim().length < 3} onPress={() => openDetailsStep(draft.goal.trim())} size="md" variant="primary">Next</Button><Button disabled={Boolean(briefTransformation)} onPress={() => setCreateGoalCustomOpen(false)} size="md" variant="secondary">Close</Button></>}
        height="full"
        onOpenChange={(open) => { if (!open && !createDetailsOpen) setCreateGoalCustomOpen(false); }}
        open={createGoalCustomOpen}
        title="Your goal"
      >
        <View style={styles.customStep}>
          <Text style={styles.inputLabel}>Goal</Text>
          <AiTextEditor accessibilityLabel="Listening goal" autoFocus editable={briefTransformation?.target !== "goal"} maxLength={2_000} multiline onChangeText={(goal) => setDraft((current) => ({ ...current, goal }))} onOpenActions={() => openBriefEditorActions("goal")} placeholder="What should change after listening?" style={styles.customTextArea} textAlignVertical="top" transformation={briefTransformation?.target === "goal" ? briefTransformation.action : undefined} value={draft.goal} />
        </View>
      </BottomSheet>

      <BottomSheet
        dismissible={!createMutation.isPending && !contextPickerOpen}
        footer={<><Button disabled={createMutation.isPending || draft.topic.trim().length < 3 || draft.goal.trim().length < 3} onPress={submit} size="md" variant="primary">Create audio book</Button><Button disabled={createMutation.isPending} onPress={() => setCreateDetailsOpen(false)} size="md" variant="secondary">Close</Button></>}
        height="full"
        onOpenChange={(open) => { if (!open && !contextPickerOpen) setCreateDetailsOpen(false); }}
        open={createDetailsOpen}
        title="Audio book details"
      >
        <ScrollView contentContainerStyle={styles.form} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
          <View style={styles.switchRow}>
            <View style={styles.switchCopy}>
              <Text style={styles.voiceName}>Chapter images</Text>
              <Text style={styles.helper}>Generate an image for each chapter.</Text>
            </View>
            <Switch accessibilityLabel="Generate chapter images" checked={draft.chapterImages} onCheckedChange={(chapterImages) => setDraft((current) => ({ ...current, chapterImages }))} />
          </View>
          <ButtonSizeProvider overrideParent size="xs">
            <View style={styles.contextActions}>
              <View style={styles.contextChip}>
                <Button accessibilityLabel="Open audio book context" contentMode="raw" onPress={() => setContextPickerOpen(true)} size="xs" style={styles.contextChipMain} variant="ghost"><Text style={styles.contextChipText}>Context</Text></Button>
                <Button accessibilityLabel="Add audio book context" contentMode="raw" hitSlop={10} iconOnly onPress={() => setContextPickerOpen(true)} shape="pill" size="xs" style={styles.contextChipAction} variant="secondary"><PlusIcon size="xs" /></Button>
              </View>
              {contextSelection.length ? <View style={styles.contextChip}>
                <Button contentMode="raw" onPress={removeAllContext} size="xs" style={styles.contextChipMain} variant="ghost"><Text style={styles.contextChipText}>Remove all</Text></Button>
                <Button accessibilityLabel="Remove all audio book context" contentMode="raw" hitSlop={10} iconOnly onPress={removeAllContext} shape="pill" size="xs" style={styles.contextChipAction} variant="secondary"><CloseIcon size="xs" /></Button>
              </View> : null}
            </View>
          </ButtonSizeProvider>
          {contextSelection.length ? <View accessibilityLabel={`${contextSelection.length} audio book context documents`} onLayout={({ nativeEvent }) => setContextGridWidth(nativeEvent.layout.width)} style={styles.contextGrid}>{contextSelection.map((ref) => { const identity = attachmentIdentity(ref); const label = contextLabels[identity] ?? "Archive document"; return <Button accessibilityLabel={`Edit context ${label}`} contentMode="raw" key={identity} onPress={() => setContextPickerOpen(true)} shape="rounded" size="md" style={[styles.contextCard, { width: contextCardSize, height: contextCardSize }]} variant="ghost"><FileIcon size="lg" /><Text ellipsizeMode="tail" numberOfLines={1} style={styles.contextCardLabel}>{label}</Text></Button>; })}</View> : null}
          {draftError ? <Text accessibilityLiveRegion="assertive" accessibilityRole="alert" style={styles.failed}>{draftError}</Text> : null}
        </ScrollView>
      </BottomSheet>

      {contextPickerOpen && createDetailsOpen ? <EmailAttachmentPicker archiveOnly context={contentContext} contextKey={`${context.organizationKey}:${context.scopeKey}:audio-book-context`} labels={contextLabels} maxSelection={MAX_CONTEXT_DOCUMENTS} onClose={() => setContextPickerOpen(false)} onDone={finishContextSelection} open selection={contextSelection} title="Context" /> : null}

      {sharingBook ? <BookSharing book={sharingBook} onClose={() => setSharingBook(undefined)} open={Boolean(sharingBook)} /> : null}

      <BottomSheet hideHeading onOpenChange={(open) => { if (!open) setBriefActionTarget(undefined); }} open={Boolean(briefActionTarget)} title="AI actions">
        <View style={styles.sheetList}>
          <BottomSheetItem onPress={() => { const target = briefActionTarget; if (target) void transformBriefEditor(target, "enhance"); }} style={styles.sheetAction} variant="secondary">Enhance</BottomSheetItem>
          <BottomSheetItem onPress={openBriefEditorTranslation} style={styles.sheetAction} variant="secondary">Translate</BottomSheetItem>
        </View>
      </BottomSheet>
      <BottomSheet footer={<><Button disabled={briefTargetLanguage.trim().length < 2} onPress={() => { const target = briefTranslateTarget; if (target) void transformBriefEditor(target, "translate"); }} size="md" variant="primary">Translate</Button><Button onPress={() => setBriefTranslateTarget(undefined)} size="md" variant="secondary">Close</Button></>} height="full" onOpenChange={(open) => { if (!open) setBriefTranslateTarget(undefined); }} open={Boolean(briefTranslateTarget)} title="Translate text">
        <View style={styles.customStep}><Text style={styles.inputLabel}>Language</Text><TextInput accessibilityLabel="Audio book brief translation language" autoFocus maxLength={100} onChangeText={setBriefTargetLanguage} placeholder="Language" value={briefTargetLanguage} /></View>
      </BottomSheet>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: palette.page },
  globalHeader: {
    minHeight: 64,
    paddingBottom: 8,
    justifyContent: "center",
    borderBottomColor: palette.hairline,
    borderBottomWidth: 1,
    backgroundColor: palette.page,
  },
  localHeader: {
    minHeight: 48,
    marginTop: spacing.md,
    paddingHorizontal: spacing.md,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  localTitle: {
    minWidth: 0,
    flex: 1,
    color: palette.silver50,
    fontFamily: fonts.medium,
    fontSize: 24,
  },
  searchRow: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.xs,
    paddingBottom: spacing.md,
    flexDirection: "row",
    gap: GRID_GAP,
  },
  rootSearch: {
    minHeight: 44,
    flex: 1,
    paddingLeft: 12,
    paddingRight: 8,
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    borderWidth: 1,
    borderColor: palette.hairline,
    borderRadius: 999,
    backgroundColor: palette.page,
  },
  rootSearchInput: {
    minHeight: 40,
    flex: 1,
    paddingHorizontal: 0,
    borderWidth: 0,
    backgroundColor: "transparent",
    fontSize: 13,
  },
  searchHistoryButton: { width: 44, height: 44 },
  bulkToolbar: { minHeight: 40, marginHorizontal: spacing.md, marginBottom: spacing.md, padding: 5, flexDirection: "row", alignItems: "center", justifyContent: "space-between", borderWidth: 1, backgroundColor: palette.panel },
  bulkToolbarSelection: { flexDirection: "row", alignItems: "center", gap: 8 },
  bulkToolbarClose: { height: 28, width: 28, paddingHorizontal: 0, paddingVertical: 0 },
  bulkSelectionText: { color: palette.silver100, fontFamily: fonts.medium, fontSize: 12 },
  library: { flexGrow: 1, paddingHorizontal: spacing.md, paddingBottom: 140 },
  grid: {
    width: "100%",
    flexDirection: "row",
    flexWrap: "wrap",
    gap: GRID_GAP,
  },
  bookCardFrame: {
    position: "relative",
    overflow: "hidden",
    borderWidth: 1,
    borderColor: palette.hairline,
    borderRadius: radii.sm,
    backgroundColor: palette.panelRaised,
  },
  bookCard: {
    width: "100%",
    height: "100%",
    overflow: "hidden",
    alignItems: "stretch",
    justifyContent: "flex-end",
    padding: 0,
    borderRadius: radii.sm,
  },
  selectedItem: { borderColor: palette.silver50, shadowColor: palette.silver50, shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.62, shadowRadius: 5, elevation: 4 },
  selectionBadge: { position: "absolute", top: 4, right: 4, width: 20, height: 20, alignItems: "center", justifyContent: "center", borderRadius: 10, backgroundColor: palette.silver50 },
  cover: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    width: "100%",
    height: "100%",
  },
  cardShade: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
  },
  cardCopy: { marginTop: "auto", padding: 8, gap: 3 },
  cardTitle: {
    color: palette.silver50,
    fontFamily: fonts.semibold,
    fontSize: 11,
    lineHeight: 14,
  },
  cardSummary: {
    color: palette.silver300,
    fontFamily: fonts.regular,
    fontSize: 8,
    lineHeight: 11,
  },
  failed: { color: "#F39A9A" },
  generationTrack: {
    height: 2,
    marginTop: 2,
    overflow: "hidden",
    borderRadius: 1,
    backgroundColor: palette.silver700,
  },
  generationFill: { height: "100%", backgroundColor: palette.silver100 },
  state: {
    minHeight: 360,
    alignItems: "center",
    justifyContent: "center",
    gap: 14,
  },
  emptyPlusButton: { width: 44, height: 44 },
  stateTitle: {
    color: palette.silver300,
    fontFamily: fonts.medium,
    fontSize: 14,
    textAlign: "center",
  },
  coreMessage: {
    padding: spacing.sm,
    borderWidth: 1,
    borderColor: palette.hairline,
    borderRadius: radii.md,
    backgroundColor: palette.panel,
  },
  sheetList: { gap: spacing.sm },
  bulkActionList: { width: "100%", gap: spacing.sm },
  compactSheetActions: { width: "100%", gap: spacing.sm, padding: 2 },
  filterPanel: { gap: 6 },
  searchHistoryOption: { backgroundColor: palette.page },
  favoriteSwitchRow: { minHeight: 32, flexDirection: "row", alignItems: "center", gap: spacing.xs },
  favoriteSwitchLabel: { color: palette.muted, fontFamily: fonts.regular, fontSize: 12 },
  sheetAction: { justifyContent: "center" },
  form: { gap: spacing.sm, paddingBottom: spacing.xl },
  extensionStep: { flex: 1, gap: spacing.sm },
  extensionTitles: { gap: 6, paddingTop: spacing.sm, paddingBottom: spacing.xl },
  extensionTitleSkeleton: { width: "100%", height: 48, borderRadius: 999 },
  extensionTitle: { color: palette.silver100, fontFamily: fonts.regular, fontSize: 13, lineHeight: 17 },
  suggestionStep: { flex: 1, gap: spacing.md },
  suggestionList: { gap: 6 },
  suggestionPill: { width: "100%", minHeight: 40, justifyContent: "flex-start", paddingHorizontal: spacing.md },
  suggestionLoadingPill: { width: "100%", height: 40, borderRadius: 999 },
  suggestionText: { color: palette.silver100, fontFamily: fonts.regular, fontSize: 13, lineHeight: 17, textAlign: "left" },
  selectedPrompt: { color: palette.silver500, fontFamily: fonts.regular, fontSize: 12, lineHeight: 17 },
  customStep: { flex: 1, gap: spacing.sm },
  stepTextArea: { flex: 1, minHeight: 220, textAlignVertical: "top" },
  customTextArea: { paddingTop: 12, lineHeight: 22 },
  inputLabel: { marginLeft: 2, color: palette.silver300, fontFamily: fonts.medium, fontSize: 12, letterSpacing: 0.4 },
  formHeading: {
    marginBottom: spacing.sm,
    color: palette.silver50,
    fontFamily: fonts.light,
    fontSize: 25,
    lineHeight: 31,
  },
  formLabel: {
    marginLeft: 2,
    marginTop: spacing.sm,
    color: palette.silver300,
    fontFamily: fonts.medium,
    fontSize: 12,
    letterSpacing: 0.4,
  },
  textArea: { minHeight: 88, textAlignVertical: "top" },
  choiceRow: { flexDirection: "row", gap: GRID_GAP },
  choice: { flex: 1, paddingHorizontal: 8 },
  voiceGrid: { gap: GRID_GAP },
  voice: {
    width: "100%",
    minHeight: 58,
    justifyContent: "flex-start",
    gap: spacing.sm,
  },
  voiceName: {
    color: palette.silver100,
    fontFamily: fonts.medium,
    fontSize: 13,
  },
  valueLabel: {
    color: palette.silver500,
    fontFamily: fonts.medium,
    fontSize: 11,
    textAlign: "right",
  },
  helper: {
    color: palette.silver500,
    fontFamily: fonts.regular,
    fontSize: 11,
    lineHeight: 16,
  },
  switchRow: {
    minHeight: 54,
    marginTop: spacing.sm,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.sm,
  },
  switchCopy: { minWidth: 0, flex: 1 },
  contextActions: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: spacing.xs },
  contextChip: { alignSelf: "flex-start", minHeight: 34, maxWidth: "100%", flexDirection: "row", alignItems: "center", gap: 6, borderWidth: 1, borderColor: "rgba(221, 226, 229, 0.18)", borderRadius: 999, backgroundColor: "rgba(255, 255, 255, 0.03)" },
  contextChipMain: { minWidth: 0, flexShrink: 1, justifyContent: "center", paddingLeft: 7, paddingRight: 0 },
  contextChipAction: { width: 24, minWidth: 24, maxWidth: 24, height: 24, minHeight: 24, maxHeight: 24, marginRight: 3, borderRadius: 12 },
  contextChipText: { minWidth: 0, flexShrink: 1, color: palette.silver100, fontFamily: fonts.medium, fontSize: 12, textAlign: "center" },
  contextGrid: { width: "100%", flexDirection: "row", flexWrap: "wrap", gap: 6 },
  contextCard: { width: "100%", height: "100%", position: "relative", overflow: "hidden", flexDirection: "column", justifyContent: "center", gap: 8, paddingHorizontal: 6, borderWidth: 1, borderColor: palette.hairline, backgroundColor: palette.panelRaised },
  contextCardLabel: { width: "100%", color: palette.silver100, fontFamily: fonts.medium, fontSize: 12, textAlign: "center" },
  detailTabs: { flexDirection: "row", gap: 4, padding: 3, borderWidth: 1, backgroundColor: palette.panel },
  detailTab: { flex: 1 },
  languageTabs: { flexDirection: "row", flexWrap: "wrap", gap: 4, padding: 3, borderWidth: 1, backgroundColor: palette.panel },
  languageTab: { width: "32%" },
  detail: { gap: spacing.lg, paddingBottom: spacing.xl },
  detailPage: { flexGrow: 1, paddingHorizontal: spacing.md },
  detailHero: { width: "100%", minHeight: (144 * 16) / 9, flexDirection: "row", alignItems: "center", justifyContent: "flex-start", gap: spacing.md, padding: 0 },
  detailCover: {
    width: 144,
    height: (144 * 16) / 9,
    flexShrink: 0,
    overflow: "hidden",
    borderRadius: radii.sm,
  },
  detailCopy: {
    minWidth: 0,
    flex: 1,
    alignItems: "flex-start",
    gap: spacing.xs,
  },
  detailCurrentLabel: { marginTop: spacing.xs, color: palette.silver300, fontFamily: fonts.medium, fontSize: 8, letterSpacing: tracking.micro },
  detailCurrentChapter: { marginTop: spacing.sm, color: palette.silver100, fontFamily: fonts.medium, fontSize: 12, lineHeight: 17 },
  detailDuration: { marginTop: spacing.sm, color: palette.silver300, fontFamily: fonts.regular, fontSize: 11 },
  detailLoading: { gap: spacing.md },
  detailCoverSkeleton: { width: 144, height: 256, borderRadius: radii.sm },
  detailLine: { width: "70%", height: 14, borderRadius: 7 },
  chapterCard: {
    overflow: "hidden",
    alignItems: "stretch",
    justifyContent: "flex-end",
    padding: 0,
    borderRadius: radii.sm,
  },
  chapterCardFill: { width: "100%", height: "100%" },
  chapterSkeleton: { borderRadius: radii.sm },
  chapterNumber: {
    color: palette.silver300,
    fontFamily: fonts.medium,
    fontSize: 9,
  },
  chapterSummaryPanel: { paddingVertical: spacing.xs },
  summarySheetContent: { flex: 1, gap: spacing.md },
  chapterSummaryText: {
    color: palette.silver300,
    fontFamily: fonts.regular,
    fontSize: 17,
    lineHeight: 28,
  },
  chapterReadingScroll: { flex: 1 },
  chapterReadingContent: { gap: spacing.md, paddingBottom: spacing.lg },
  chapterReadingParagraph: { color: palette.silver100, fontFamily: fonts.regular, fontSize: 17, lineHeight: 29 },
  chapterReadingUnavailable: { color: palette.silver500, fontFamily: fonts.regular, fontSize: 14, lineHeight: 21 },
  chapterReadingFooter: { width: "100%", gap: spacing.sm },
  chapterReadingSteps: { width: "100%", flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  narrationPlayer: { marginHorizontal: 4, marginBottom: spacing.xs, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, gap: spacing.xs, borderRadius: radii.lg, borderColor: palette.hairline, borderWidth: 1, backgroundColor: palette.voidBlack },
  narrationHeading: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  narrationTitleBlock: { flex: 1, gap: 2 },
  narrationTitle: { color: palette.silver50, fontFamily: fonts.medium, fontSize: 13 },
  narrationControls: { flexDirection: "row", alignItems: "center", gap: spacing.xs },
  narrationSlider: { flex: 1 },
  narrationTime: { minWidth: 32, color: palette.silver300, fontFamily: fonts.regular, fontSize: 10, textAlign: "center" },
  narrationError: { color: "#D98B8B", fontFamily: fonts.regular, fontSize: 10, lineHeight: 14 },
  noticeText: {
    minWidth: 0,
    flex: 1,
    color: palette.silver300,
    fontFamily: fonts.regular,
    fontSize: 12,
  },
});
