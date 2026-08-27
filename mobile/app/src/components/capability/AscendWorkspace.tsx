import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { AudioStatus } from "expo-audio";
import { randomUUID } from "expo-crypto";
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
import { AiTextEditor } from "@vorinthex/shared/ui/ai-text-editor";
import { Button } from "@vorinthex/shared/ui/button";
import { CoreComposer } from "@vorinthex/shared/ui/core-composer";
import { Slider } from "@vorinthex/shared/ui/slider";
import { Skeleton } from "@vorinthex/shared/ui/skeleton";
import { Switch } from "@vorinthex/shared/ui/switch";
import { Tabs } from "@vorinthex/shared/ui/tabs";
import { TextInput } from "@vorinthex/shared/ui/text-input";
import { useToast } from "@vorinthex/shared/ui/toast";
import {
  CheckIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  ClockIcon,
  CloseIcon,
  FileIcon,
  FilterIcon,
  FolderIcon,
  MoreHorizontalIcon,
  PauseIcon,
  PlayIcon,
  PlusIcon,
  SearchIcon,
  SendIcon,
  TrashIcon,
  VolumeIcon,
} from "@vorinthex/shared/ui/icons-mobile";

import { ChromeIcon } from "@/components/ChromeIcon";
import { SearchHistorySheet } from "@/components/SearchHistorySheet";
import { WorkspaceAppSwitcher } from "@/components/capability/WorkspaceAppSwitcher";
import { assistantIconSource } from "@/data/capability-icons";
import { enhanceAppTextForContext, translateAppTextForContext } from "@/lib/app-transformation-client";
import { languageForCountryCode } from "@/lib/auth-helpers";
import { useBookPlayback } from "@/lib/book-playback";
import { restoredBookDraft, retryBookCreateRequestKey, type FailedBookCreate } from "@/lib/book-create-retry";
import {
  activeTranscriptPhrase,
  buildTranscriptPhrases,
} from "@/lib/book-transcript";
import {
  askBookAssistant,
  cancelBook,
  createBook,
  deleteBook,
  fetchBookDetail,
  fetchBooksOverview,
  getBooksContext,
  retryBook,
  suggestBookGoals,
  suggestBookTopics,
  type Book,
  type BookChapter,
  type BookDetail,
  type BookStatus,
  type CreateBookInput,
} from "@/lib/books-client";
import {
  deleteContentSearchHistory,
  getContentContext,
  listContentFolderTree,
  searchContentMatches,
  type ContentDocument,
  type ContentSearchHistoryItem,
} from "@/lib/content-client";
import {
  contentFolderStack,
  contentQueryKeys,
  getContentLocation,
} from "@/lib/content-query-cache";
import {
  addCachedBook,
  ascendQueryKeys,
  invalidateAssistantChanges,
  mergeBookDetailProgress,
  patchCachedBook,
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
const CHAPTER_OPTIONS = [
  { count: 10, label: "Short" },
  { count: 25, label: "Standard" },
  { count: 50, label: "Deep" },
] as const;
const LANGUAGES = ["English", "Swedish", "Spanish", "French", "German", "Portuguese"] as const;
const SPEEDS = [0.75, 1, 1.25, 1.5, 2] as const;
const SLEEP_MINUTES = [0, 10, 20, 30, 45, 60] as const;
const MAX_SOURCE_DOCUMENTS = 50;
const DEFAULT_NARRATOR = { key: "clear" as const, name: "Clear" };
const TONES = [
  "Clear and practical",
  "Warm and encouraging",
  "Rigorous and analytical",
  "Narrative and vivid",
] as const;
const CORE_PROMPTS = [
  "Write a field guide to deep work",
  "Create a book about lucid dreaming",
  "Turn my idea into a short handbook",
] as const;
const GRADIENTS = [
  ["#30363D", "#0A0E13", "#020304"],
  ["#283139", "#11161C", "#050607"],
  ["#3B3A38", "#171512", "#050504"],
] as const;

type LibrarySheet =
  | "actions"
  | "create"
  | "createTopicCustom"
  | "createGoal"
  | "createGoalCustom"
  | "createKnowledge"
  | "createDetails"
  | "sources"
  | "filter"
  | "searchHistory"
  | "reader"
  | "sleep"
  | "bookActions"
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
  chapterCount: 25,
  language: "English",
  writingTone: TONES[0]!.toString(),
  narratorVoiceKey: DEFAULT_NARRATOR.key,
  narrationPace: 1,
  archiveDocumentKeys: [],
  chapterImages: true,
  additionalInstructions: "",
};

function errorMessage(error: unknown) {
  return error instanceof Error
    ? error.message
    : "The request could not be completed.";
}
function formatTime(seconds: number) {
  const safe = Math.max(0, Math.floor(seconds));
  return `${Math.floor(safe / 60)}:${String(safe % 60).padStart(2, "0")}`;
}
function statusLabel(status: BookStatus) {
  return status.charAt(0).toUpperCase() + status.slice(1);
}

function Cover({ book, index = 0 }: { book: Book; index?: number }) {
  if (book.coverUrl)
    return (
      <Image
        accessibilityLabel={`${book.title} cover`}
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

function ChapterCard({ chapter, reducedMotion, width, onPress }: { chapter: BookChapter; reducedMotion: boolean; width: number; onPress: () => void }) {
  const entrance = useRef(new Animated.Value(reducedMotion ? 1 : 0)).current;
  useEffect(() => {
    if (reducedMotion) { entrance.setValue(1); return; }
    const animation = Animated.spring(entrance, { toValue: 1, damping: 15, stiffness: 180, mass: 0.8, useNativeDriver: true });
    animation.start();
    return () => animation.stop();
  }, [entrance, reducedMotion]);
  return (
    <Animated.View style={{ width, height: (width * 16) / 9, opacity: entrance, transform: [{ scale: entrance.interpolate({ inputRange: [0, 1], outputRange: [0.88, 1] }) }] }}>
      <Button accessibilityLabel={`Chapter ${chapter.position}, ${chapter.title}${chapter.isCompleted ? ", completed" : ""}`} contentMode="raw" onPress={onPress} shape="rounded" size="md" style={[styles.chapterCard, styles.chapterCardFill]} variant="ghost">
        {chapter.imageUrl ? <Image contentFit="cover" source={chapter.imageUrl} style={styles.cover} /> : <LinearGradient colors={GRADIENTS[(chapter.position - 1) % GRADIENTS.length]!} style={styles.cover} />}
        <View style={styles.cardShade} />
        <View style={styles.cardCopy}>
          <Text style={styles.chapterNumber}>{String(chapter.position).padStart(2, "0")}</Text>
          <Text numberOfLines={3} style={styles.cardTitle}>{chapter.title}</Text>
          <Text style={styles.cardStatus}>{chapter.isCompleted ? "Completed" : `${chapter.estimatedMinutes ?? Math.ceil((chapter.audioDurationSeconds ?? 0) / 60)} min`}</Text>
        </View>
        {chapter.isCompleted ? <View style={styles.check}><CheckIcon size="sm" variant="inverse" /></View> : null}
      </Button>
    </Animated.View>
  );
}

type ReaderProps = {
  audio: AudioStatus;
  chapter?: BookChapter;
  chapterIndex: number;
  currentTime: number;
  detail: BookDetail;
  duration: number;
  onBack: () => void;
  onMoveChapter: (offset: number) => void;
  onRefreshUrl: () => void;
  onSeek: (seconds: number) => void;
  onSleep: () => void;
  onSpeed: () => void;
  onToggle: () => void;
  ordered: BookChapter[];
  playbackError?: string;
  persistenceError?: string;
  refreshingUrl: boolean;
  sleepMinutes: number;
  speed: number;
};

function Reader({
  audio,
  chapter,
  chapterIndex,
  currentTime,
  detail,
  duration,
  onBack,
  onMoveChapter,
  onRefreshUrl,
  onSeek,
  onSleep,
  onSpeed,
  onToggle,
  ordered,
  playbackError,
  persistenceError,
  refreshingUrl,
  sleepMinutes,
  speed,
}: ReaderProps) {
  const phrases = buildTranscriptPhrases(chapter?.content ?? "");
  const activePhrase = activeTranscriptPhrase(
    phrases,
    duration ? currentTime / duration : 0,
  );
  const transcriptScroll = useRef<ScrollView>(null);
  const phraseOffsets = useRef(new Map<number, number>());
  const [reducedMotion, setReducedMotion] = useState(false);
  useEffect(() => {
    let mounted = true;
    void AccessibilityInfo.isReduceMotionEnabled().then((enabled) => {
      if (mounted) setReducedMotion(enabled);
    });
    const subscription = AccessibilityInfo.addEventListener(
      "reduceMotionChanged",
      setReducedMotion,
    );
    return () => {
      mounted = false;
      subscription.remove();
    };
  }, []);
  useEffect(() => {
    if (!audio.playing || activePhrase < 0) return;
    const y = phraseOffsets.current.get(activePhrase);
    if (y !== undefined)
      transcriptScroll.current?.scrollTo({
        y: Math.max(0, y - 120),
        animated: !reducedMotion,
      });
  }, [activePhrase, audio.playing, reducedMotion]);
  return (
    <View style={styles.reader}>
      <View style={styles.readerHeader}>
        <Button
          accessibilityLabel="Back to book"
          contentMode="raw"
          onPress={onBack}
          size="md"
          variant="icon"
        >
          <ChevronLeftIcon size="sm" />
        </Button>
        <View style={styles.readerIdentity}>
          <Text style={styles.micro}>
            CHAPTER {chapter?.position ?? 0} OF {ordered.length}
          </Text>
          <Text numberOfLines={1} style={styles.readerTitle}>
            {chapter?.title ?? "Chapter"}
          </Text>
        </View>
        <Button
          accessibilityLabel="Sleep timer"
          contentMode="raw"
          onPress={onSleep}
          size="md"
          variant="icon"
        >
          <ClockIcon size="sm" variant={sleepMinutes ? "accent" : "default"} />
        </Button>
      </View>
      <ScrollView
        ref={transcriptScroll}
        contentContainerStyle={styles.transcript}
        showsVerticalScrollIndicator={false}
      >
        {phrases.length ? (
          phrases.map((phrase, index) => (
            <Text
              key={`${index}-${phrase.text.slice(0, 16)}`}
              onLayout={({ nativeEvent }) =>
                phraseOffsets.current.set(index, nativeEvent.layout.y)
              }
              selectable
              style={[
                styles.phrase,
                index === activePhrase && styles.activePhrase,
                index < activePhrase && styles.pastPhrase,
              ]}
            >
              {phrase.text}
            </Text>
          ))
        ) : (
          <Text selectable style={styles.chapterBody}>
            {chapter?.content || "Transcript is unavailable for this chapter."}
          </Text>
        )}
      </ScrollView>
      <View style={styles.playerPanel}>
        {playbackError || audio.error ? (
          <View accessibilityRole="alert" style={styles.playerNotice}>
            <Text numberOfLines={2} style={styles.noticeText}>
              {playbackError ?? "Audio needs a fresh connection."}
            </Text>
            <Button
              disabled={refreshingUrl}
              loading={refreshingUrl}
              onPress={onRefreshUrl}
              size="md"
              variant="secondary"
            >
              Retry
            </Button>
          </View>
        ) : null}
        {audio.isBuffering ? (
          <Text accessibilityLiveRegion="polite" style={styles.buffering}>
            Buffering audio...
          </Text>
        ) : null}
        {persistenceError ? (
          <Text
            accessibilityLiveRegion="polite"
            style={styles.persistenceNotice}
          >
            {persistenceError}
          </Text>
        ) : null}
        <Slider
          accessibilityLabel="Chapter position"
          disabled={!duration || Boolean(audio.error) || Boolean(playbackError)}
          max={Math.max(1, duration)}
          min={0}
          onSlidingComplete={onSeek}
          value={currentTime}
        />
        <View style={styles.timeRow}>
          <Text style={styles.time}>{formatTime(currentTime)}</Text>
          <Text style={styles.time}>
            -{formatTime(Math.max(0, duration - currentTime))}
          </Text>
        </View>
        <View style={styles.playbackRow}>
          <Button
            accessibilityLabel="Previous chapter"
            contentMode="raw"
            disabled={chapterIndex <= 0}
            onPress={() => onMoveChapter(-1)}
            size="md"
            variant="icon"
          >
            <ChevronLeftIcon />
          </Button>
          <Button
            accessibilityLabel="Skip back 15 seconds"
            onPress={() => onSeek(currentTime - 15)}
            size="md"
            variant="secondary"
          >
            -15
          </Button>
          <Button
            accessibilityLabel={audio.playing ? "Pause" : "Play"}
            contentMode="raw"
            disabled={
              !chapter?.audioUrl ||
              Boolean(audio.error) ||
              Boolean(playbackError)
            }
            onPress={onToggle}
            size="md"
            style={styles.playButton}
            variant="primary"
          >
            {audio.playing ? (
              <PauseIcon variant="inverse" />
            ) : (
              <PlayIcon variant="inverse" />
            )}
          </Button>
          <Button
            accessibilityLabel="Skip forward 15 seconds"
            onPress={() => onSeek(currentTime + 15)}
            size="md"
            variant="secondary"
          >
            +15
          </Button>
          <Button
            accessibilityLabel="Next chapter"
            contentMode="raw"
            disabled={chapterIndex < 0 || chapterIndex >= ordered.length - 1}
            onPress={() => onMoveChapter(1)}
            size="md"
            variant="icon"
          >
            <ChevronRightIcon />
          </Button>
        </View>
        <View style={styles.secondaryControls}>
          <Button
            icon={<VolumeIcon size="sm" />}
            onPress={onSpeed}
            size="md"
            variant="secondary"
          >
            {speed}x
          </Button>
          <Text numberOfLines={1} style={styles.readerBook}>
            {detail.book.title}
          </Text>
        </View>
      </View>
    </View>
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
  const [selectedBookKey, setSelectedBookKey] = useState<string>();
  const [autoOpenBookKey, setAutoOpenBookKey] = useState<string>();
  const [bookPageOpen, setBookPageOpen] = useState(false);
  const [revealedChapterCount, setRevealedChapterCount] = useState(0);
  const [reducedChapterMotion, setReducedChapterMotion] = useState(false);
  const [query, setQuery] = useState("");
  const [chapterQuery, setChapterQuery] = useState("");
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
  const [archiveFolderKey, setArchiveFolderKey] = useState<string>();
  const [documentQuery, setDocumentQuery] = useState("");
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

  const overviewQuery = useQuery({
    queryKey: ascendQueryKeys.overview(context),
    queryFn: fetchBooksOverview,
    refetchInterval: (query) => autoOpenBookKey || query.state.data?.books.some(({ status }) => ACTIVE_STATUSES.includes(status)) ? 2_000 : false,
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
  const folderTreeQuery = useQuery({
    enabled: sheet === "sources",
    queryKey: contentQueryKeys.folderTree(contentContext),
    queryFn: ({ signal }) => listContentFolderTree(signal, contentContext),
  });
  const documentsQuery = useQuery({
    enabled: sheet === "sources",
    queryKey: [
      ...contentQueryKeys.all(contentContext),
      "book-source-picker",
      documentQuery.trim() || archiveFolderKey || null,
    ],
    queryFn: async ({ signal }) => {
      if (documentQuery.trim()) {
        const result = await searchContentMatches(
          documentQuery.trim(),
          signal,
          undefined,
          false,
        );
        return {
          folders: result.folders,
          documents: result.documents.map((document) => ({
            key: document.documentKey,
            name: document.name,
            extension: document.extension,
            folderKey: document.folderKey,
            isFavorite: document.isFavorite,
            updatedAt: "",
          })),
        };
      }
      return getContentLocation(queryClient, contentContext, archiveFolderKey);
    },
  });
  const serverBooks = overviewQuery.data?.books ?? [];
  const books = [...pendingQuery.data.map(({ book }) => book), ...serverBooks];
  const selectedBook =
    books.find(({ key }) => key === selectedBookKey) ?? detailQuery.data?.book;
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
  const creating = Boolean(sheet?.startsWith("create") || sheet === "sources");
  const creationParent: LibrarySheet | undefined =
    sheet === "createTopicCustom" || sheet === "createGoal"
      ? "create"
      : sheet === "createGoalCustom" || sheet === "createKnowledge"
        ? "createGoal"
        : sheet === "createDetails"
          ? "createKnowledge"
          : sheet === "sources"
            ? "createDetails"
            : undefined;

  useEffect(() => () => {
    if (rootSearchFocusTimer.current) clearTimeout(rootSearchFocusTimer.current);
  }, []);
  useEffect(() => {
    let mounted = true;
    void AccessibilityInfo.isReduceMotionEnabled().then((enabled) => { if (mounted) setReducedChapterMotion(enabled); });
    const subscription = AccessibilityInfo.addEventListener("reduceMotionChanged", setReducedChapterMotion);
    return () => { mounted = false; subscription.remove(); };
  }, []);
  const archiveStack = contentFolderStack(
    folderTreeQuery.data ?? [],
    archiveFolderKey,
  );

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
        subtitle: "Preparing your book",
        description: input.goal,
        status: "queued",
        isFavorite: false,
        narrator: DEFAULT_NARRATOR,
        estimatedMinutes: input.chapterCount * 4,
        chapterCount: input.chapterCount,
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
      setAutoOpenBookKey(book.key);
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
        setSheet("createDetails");
        setSheetOpen(true);
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
        setAutoOpenBookKey((current) => current === book.key ? undefined : current);
        setSheetOpen(false);
      } else patchCachedBook(queryClient, context, book);
    },
    onError: (error) => {
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

  function open(next: LibrarySheet) {
    setSheet(next);
    setSheetOpen(true);
  }
  function beginCreate() {
    setDraft(INITIAL_DRAFT);
    setTopicSuggestions([]);
    setTopicSuggestionsError(undefined);
    setGoalSuggestions([]);
    setDraftError(undefined);
    setDocumentQuery("");
    setArchiveFolderKey(undefined);
    open("create");
    topicSuggestionsMutation.mutate([]);
  }
  function loadNewTopics() {
    setTopicSuggestionsError(undefined);
    topicSuggestionsMutation.mutate(topicSuggestions);
  }
  function briefEditorText(target: BriefEditorTarget) {
    return target === "topic" ? draft.topic : draft.goal;
  }
  function applyBriefEditorText(target: BriefEditorTarget, value: string) {
    setDraft((current) => ({ ...current, [target]: value }));
  }
  function openBriefEditorActions(target: BriefEditorTarget) {
    if (briefTransformation || !briefEditorText(target).trim()) return;
    setBriefActionTarget(target);
  }
  function openBriefEditorTranslation() {
    if (!briefActionTarget) return;
    setBriefTargetLanguage(languageForCountryCode(countryCode));
    setBriefTranslateTarget(briefActionTarget);
    setBriefActionTarget(undefined);
  }
  async function transformBriefEditor(target: BriefEditorTarget, action: BriefTransformation["action"]) {
    if (briefTransformation) return;
    const text = briefEditorText(target).trim();
    const language = briefTargetLanguage.trim();
    if (!text || action === "translate" && language.length < 2) return;
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
    setSheet("createGoal");
    goalSuggestionsMutation.mutate({ topic, excludeGoals: [] });
  }
  function loadNewGoals() {
    setGoalSuggestionsError(undefined);
    goalSuggestionsMutation.mutate({ topic: draft.topic, excludeGoals: goalSuggestions });
  }
  function openKnowledgeStep(goal: string) {
    setDraft((current) => ({ ...current, goal }));
    setDraftError(undefined);
    setSheet("createKnowledge");
  }
  function submit() {
    if (
      draft.topic.trim().length < 3 ||
      draft.goal.trim().length < 3 ||
      draft.language.trim().length < 2
    ) {
      setDraftError(
        "Complete the topic, goal, and language before creating your book.",
      );
      return;
    }
    if (draft.archiveDocumentKeys.length > MAX_SOURCE_DOCUMENTS) {
      setDraftError(
        `Choose no more than ${MAX_SOURCE_DOCUMENTS} Archive documents.`,
      );
      return;
    }
    const input = {
      ...draft,
      narratorVoiceKey: DEFAULT_NARRATOR.key,
      narrationPace: 1,
      additionalInstructions: draft.additionalInstructions?.trim() || undefined,
    };
    const requestKey = retryBookCreateRequestKey(failedCreate.current, input, randomUUID);
    setDraftError(undefined);
    setSheetOpen(false);
    setSheet(undefined);
    setDraft(INITIAL_DRAFT);
    createMutation.mutate({ input, requestKey });
  }
  function chooseBook(book: Book) {
    setSelectedBookKey(book.key);
    setChapterQuery("");
    if (book.status === "failed" || book.status === "cancelled") open("bookActions");
    else if (book.coverUrl) {
      setBookPageOpen(true);
      setSheetOpen(false);
      setSheet(undefined);
    }
  }
  function startReader(chapterKey?: string) {
    if (!detail) return;
    const playable = detail.chapters.filter((chapter) => chapter.content && chapter.audioUrl).sort((left, right) => left.position - right.position);
    const nextChapterKey =
      chapterKey ??
      playable.find(({ key }) => key === detail.book.currentChapterKey)?.key ??
      playable.find(({ isCompleted }) => !isCompleted)?.key ??
      playable[0]?.key;
    if (!nextChapterKey) {
      showToast({
        title: "This book has no available chapter to play.",
        duration: 2_500,
      });
      return;
    }
    open("reader");
    void playback.playBookChapter(detail.book.key, nextChapterKey, true);
  }
  function toggleDocument(document: ContentDocument) {
    if (draft.archiveDocumentKeys.includes(document.key)) {
      setDraft((current) => ({
        ...current,
        archiveDocumentKeys: current.archiveDocumentKeys.filter(
          (key) => key !== document.key,
        ),
      }));
      setDraftError(undefined);
      return;
    }
    if (draft.archiveDocumentKeys.length >= MAX_SOURCE_DOCUMENTS) {
      setDraftError(
        `You can select up to ${MAX_SOURCE_DOCUMENTS} Archive documents.`,
      );
      return;
    }
    setDraft((current) => ({
      ...current,
      archiveDocumentKeys: [...current.archiveDocumentKeys, document.key],
    }));
    setDraftError(undefined);
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
      setSelectedBookKey(playback.playbackBookKey);
      setBookPageOpen(true);
      setSheet("reader");
      setSheetOpen(true);
    });
    return () => cancelAnimationFrame(frame);
  }, [playback.playbackBookKey, playback.readerRequest]);

  useEffect(() => {
    if (!autoOpenBookKey) return;
    const book = serverBooks.find(({ key }) => key === autoOpenBookKey);
    if (!book) return;
    if (book.status === "failed" || book.status === "cancelled") { setAutoOpenBookKey(undefined); return; }
    if (!book.coverUrl) return;
    setSelectedBookKey(book.key);
    setChapterQuery("");
    setBookPageOpen(true);
    setSheetOpen(false);
    setSheet(undefined);
    setAutoOpenBookKey(undefined);
  }, [autoOpenBookKey, serverBooks]);

  const orderedReadyChapters: BookChapter[] = [];
  for (const chapter of [...(detail?.chapters ?? [])].sort((left, right) => left.position - right.position)) {
    if (!chapter.content || !chapter.audioUrl) break;
    orderedReadyChapters.push(chapter);
  }
  useEffect(() => { setRevealedChapterCount(0); }, [selectedBookKey]);
  useEffect(() => {
    if (revealedChapterCount >= orderedReadyChapters.length) return;
    if (reducedChapterMotion) { setRevealedChapterCount(orderedReadyChapters.length); return; }
    const timer = setTimeout(() => setRevealedChapterCount((current) => Math.min(current + 1, orderedReadyChapters.length)), 110);
    return () => clearTimeout(timer);
  }, [orderedReadyChapters.length, reducedChapterMotion, revealedChapterCount]);
  const revealedChapters = orderedReadyChapters.slice(0, revealedChapterCount);
  const chapters = revealedChapters.filter((chapter) =>
      `${chapter.position} ${chapter.title} ${chapter.description}`
        .toLowerCase()
        .includes(chapterQuery.trim().toLowerCase()),
    );
  const showNextChapterSkeleton = !chapterQuery.trim() && Boolean(detail) && (
    revealedChapterCount < orderedReadyChapters.length ||
    ACTIVE_STATUSES.includes(detail!.book.status) && orderedReadyChapters.length < detail!.book.chapterCount
  );
  const sheetTitle =
    sheet === "actions"
      ? ""
      : sheet === "create"
        ? "Choose a topic"
        : sheet === "createTopicCustom"
          ? "Your topic"
          : sheet === "createGoal"
            ? "Choose a goal"
            : sheet === "createGoalCustom"
              ? "Your goal"
              : sheet === "createKnowledge"
                ? "What you already know"
                : sheet === "createDetails"
                  ? "Book details"
        : sheet === "sources"
          ? "Choose Archive documents"
          : sheet === "filter"
            ? "Filter books"
            : sheet === "reader"
              ? "Reader"
              : sheet === "sleep"
                ? "Sleep timer"
                : sheet === "delete"
                  ? "Delete book?"
                  : (selectedBook?.title ?? "Book");
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
            !(creating && sheetOpen && dirty)
          }
        />
      </View>
      <View style={styles.localHeader}>
        {bookPageOpen ? <Button accessibilityLabel="Back to books" contentMode="raw" onPress={() => { setBookPageOpen(false); setSelectedBookKey(undefined); setChapterQuery(""); }} size="xs" variant="icon"><ChevronLeftIcon size="sm" /></Button> : <WorkspaceAppSwitcher active="ascend" trigger="back" />}
        <Text numberOfLines={1} style={styles.localTitle}>{bookPageOpen ? selectedBook?.title ?? "Book" : "Ascend"}</Text>
        {bookPageOpen ? <Button accessibilityLabel="Book actions" contentMode="raw" disabled={!selectedBook} onPress={() => open("bookActions")} size="xs" variant="icon"><MoreHorizontalIcon size="sm" /></Button> : <Button accessibilityLabel="Create in Ascend" contentMode="raw" onPress={() => open("actions")} size="xs" variant="icon"><PlusIcon size="sm" /></Button>}
      </View>
      {bookPageOpen ? (
        detailQuery.isPending ? <View accessibilityRole="progressbar" style={[styles.detailLoading, styles.detailPage]}><Skeleton style={styles.detailCoverSkeleton} /><Skeleton style={styles.detailLine} /><Skeleton style={[styles.chapterSkeleton, { width: chapterWidth, height: (chapterWidth * 16) / 9 }]} /></View> : detail ? (
          <ScrollView contentContainerStyle={[styles.detail, styles.detailPage]} showsVerticalScrollIndicator={false}>
            <View style={styles.detailHero}>
              <View style={styles.detailCover}><Cover book={detail.book} /></View>
              <View style={styles.detailCopy}>
                <Text style={styles.detailTitle}>{detail.book.title}</Text>
                <Text style={styles.detailMeta}>{detail.book.narrator?.name ?? "Narrator"} · {detail.book.estimatedMinutes} min</Text>
                <Text style={styles.detailMeta}>{Math.round(detail.book.progressPercent)}% complete</Text>
                <Button disabled={!orderedReadyChapters.length} icon={<PlayIcon size="sm" variant="inverse" />} onPress={() => { if (playback.playbackBookKey === detail.book.key) void playback.refreshUrl(); else startReader(); }} size="md" variant="primary">{detail.book.progressPercent ? "Resume" : "Play"}</Button>
              </View>
            </View>
            {playback.refreshWarning ? <View accessibilityRole="alert" style={styles.playerNotice}><Text style={styles.noticeText}>{playback.refreshWarning}</Text><Button disabled={playback.refreshingUrl} loading={playback.refreshingUrl} onPress={() => startReader()} size="md" variant="secondary">Retry</Button></View> : null}
            <View style={styles.chapterSearch}><SearchIcon size="sm" variant="muted" /><TextInput accessibilityLabel="Search chapters" onChangeText={setChapterQuery} placeholder="Search chapters" style={styles.rootSearchInput} value={chapterQuery} /></View>
            <View onLayout={({ nativeEvent }) => setChapterGridWidth(nativeEvent.layout.width)} style={styles.grid}>
              {chapters.map((chapter) => <ChapterCard chapter={chapter} key={chapter.key} onPress={() => startReader(chapter.key)} reducedMotion={reducedChapterMotion} width={chapterWidth} />)}
              {showNextChapterSkeleton ? <Skeleton accessibilityLabel={`Preparing chapter ${revealedChapterCount + 1}`} accessibilityRole="progressbar" style={[styles.chapterSkeleton, { width: chapterWidth, height: (chapterWidth * 16) / 9 }]} /> : null}
            </View>
          </ScrollView>
        ) : <View accessibilityRole="alert" style={styles.state}><Text style={styles.stateTitle}>Book details could not be loaded.</Text><Button onPress={() => void detailQuery.refetch()} size="sm" variant="secondary">Retry</Button></View>
      ) : <>
        <View style={styles.searchRow}>
          <View style={styles.rootSearch}><SearchIcon size="sm" variant="muted" /><TextInput accessibilityLabel="Search books" editable={rootSearchFocusable} focusable={rootSearchFocusable} onChangeText={setQuery} placeholder="Search..." ref={rootSearchInputRef} style={styles.rootSearchInput} value={query} />{query ? <Button accessibilityLabel="Clear book search" contentMode="raw" iconOnly onPress={() => setQuery("")} size="xs" variant="secondary"><CloseIcon size="sm" /></Button> : null}</View>
          <Button accessibilityLabel="Filter books" contentMode="raw" onPress={() => open("filter")} size="sm" style={styles.searchHistoryButton} variant="icon"><FilterIcon size="sm" variant={showOnlyFavorites ? "accent" : "default"} /></Button>
        </View>
        <ScrollView contentContainerStyle={styles.library} showsVerticalScrollIndicator={false}>
          {overviewQuery.isPending ? <View accessibilityLabel="Loading books" accessibilityRole="progressbar" onLayout={({ nativeEvent }) => setGridWidth(nativeEvent.layout.width)} style={styles.grid}>{Array.from({ length: COLUMNS }, (_, index) => <Skeleton key={index} style={{ width: cardWidth, height: (cardWidth * 16) / 9, borderRadius: radii.sm }} />)}</View> : overviewQuery.error ? <View style={styles.state}><Text style={styles.stateTitle}>Books could not be loaded.</Text><Button onPress={() => void overviewQuery.refetch()} size="sm" variant="secondary">Retry</Button></View> : (
            <View onLayout={({ nativeEvent }) => setGridWidth(nativeEvent.layout.width)} style={styles.grid}>
              {filteredBooks.map((book, index) => book.key.startsWith("pending-") || ACTIVE_STATUSES.includes(book.status) && !book.coverUrl ? <Skeleton accessibilityLabel={`Preparing ${book.title}`} accessibilityRole="progressbar" key={book.key} style={{ width: cardWidth, height: (cardWidth * 16) / 9, borderRadius: radii.sm }} /> : <Button accessibilityLabel={book.title} accessibilityRole="button" contentMode="raw" key={book.key} onPress={() => chooseBook(book)} shape="rounded" size="md" style={[styles.bookCard, { width: cardWidth, height: (cardWidth * 16) / 9 }]} variant="ghost"><Cover book={book} index={index} /><View style={styles.cardShade} /><View style={styles.cardCopy}><Text numberOfLines={3} style={styles.cardTitle}>{book.title}</Text></View></Button>)}
            </View>
          )}
          {!overviewQuery.isPending && !overviewQuery.error && filteredBooks.length === 0 ? <View style={styles.state}><Text style={styles.stateTitle}>{query.trim() ? "No books matched this search." : showOnlyFavorites ? "No favorite books." : books.length ? "No books match this view." : "No audio book yet."}</Text>{!books.length && !query.trim() && !showOnlyFavorites ? <Button accessibilityLabel="Create book" contentMode="raw" onPress={beginCreate} size="md" style={styles.emptyPlusButton} variant="icon"><PlusIcon size="sm" /></Button> : null}</View> : null}
        </ScrollView>
      </>}
      <CoreComposer
        accessibilityLabel="Ask Core about Ascend"
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
        description={
          sheet === "createKnowledge"
            ? "Optional. Leave this blank to start from the beginning."
            : sheet === "sources"
              ? "Only documents you explicitly choose are included."
              : undefined
        }
        dismissible={!briefTransformation && (Boolean(creationParent) || !creating || !dirty)}
        footer={sheet === "create" ? <><Button disabled={topicSuggestionsMutation.isPending} onPress={loadNewTopics} size="md" variant="primary">New topics</Button><Button onPress={() => { setSheetOpen(false); setSheet(undefined); }} size="md" variant="secondary">Close</Button></> : sheet === "createTopicCustom" ? <><Button disabled={Boolean(briefTransformation) || draft.topic.trim().length < 3} onPress={() => openGoalStep(draft.topic.trim())} size="md" variant="primary">Next</Button><Button disabled={Boolean(briefTransformation)} onPress={() => setSheet("create")} size="md" variant="secondary">Close</Button></> : sheet === "createGoal" ? <><Button disabled={goalSuggestionsMutation.isPending} onPress={loadNewGoals} size="md" variant="primary">New goals</Button><Button onPress={() => setSheet("create")} size="md" variant="secondary">Close</Button></> : sheet === "createGoalCustom" ? <><Button disabled={Boolean(briefTransformation) || draft.goal.trim().length < 3} onPress={() => openKnowledgeStep(draft.goal.trim())} size="md" variant="primary">Next</Button><Button disabled={Boolean(briefTransformation)} onPress={() => setSheet("createGoal")} size="md" variant="secondary">Close</Button></> : undefined}
        headerLeading={
          sheet === "sources" ? (
            <Button
              accessibilityLabel="Back to book creation"
              contentMode="raw"
              onPress={() => setSheet("createDetails")}
              size="md"
              variant="icon"
            >
              <ChevronLeftIcon size="sm" />
            </Button>
          ) : undefined
        }
        height={
          ["create", "createTopicCustom", "createGoal", "createGoalCustom", "createKnowledge", "createDetails", "sources", "reader", "sleep"].includes(
            sheet ?? "",
          )
            ? "full"
            : undefined
        }
        hideHeading={sheet === "actions" || sheet === "filter"}
        onDismissRequest={creationParent ? () => setSheet(creationParent) : undefined}
        onOpenChange={(next) => {
          setSheetOpen(next);
          if (!next) setSheet(undefined);
        }}
        open={sheetOpen && sheet !== "searchHistory"}
        pageKey={sheet}
        title={sheetTitle}
      >
        {sheet === "actions" ? (
          <BottomSheetItem
            onPress={beginCreate}
            style={styles.sheetAction}
            variant="secondary"
          >
            Create book
          </BottomSheetItem>
        ) : null}
        {sheet === "filter" ? (
          <View style={styles.filterPanel}>
            <View style={styles.favoriteSwitchRow}>
              <Switch accessibilityLabel="Show only favorite books" checked={showOnlyFavorites} onCheckedChange={(checked) => { setShowOnlyFavorites(checked); setSheetOpen(false); setSheet(undefined); }} />
              <Text style={styles.favoriteSwitchLabel}>Favorites</Text>
            </View>
            <Button onPress={() => void openSearchHistory()} size="md" style={styles.searchHistoryOption} variant="secondary">Search history</Button>
          </View>
        ) : null}
        {sheet === "create" ? (
          <ScrollView contentContainerStyle={styles.suggestionStep} showsVerticalScrollIndicator={false}>
            <View style={styles.suggestionList}>
              {!topicSuggestionsMutation.isPending && topicSuggestions.length ? <Button onPress={() => setSheet("createTopicCustom")} shape="pill" size="md" style={styles.suggestionPill} variant="secondary">Custom</Button> : null}
              {topicSuggestionsMutation.isPending ? Array.from({ length: 3 }, (_, index) => <Skeleton key={index} style={styles.suggestionLoadingPill} />) : topicSuggestions.map((topic) => <Button contentMode="raw" key={topic} onPress={() => openGoalStep(topic)} shape="pill" size="md" style={styles.suggestionPill} variant="secondary"><Text numberOfLines={1} style={styles.suggestionText}>{topic}</Text></Button>)}
            </View>
            {topicSuggestionsError ? <Text accessibilityRole="alert" style={styles.noticeText}>{topicSuggestionsError}</Text> : null}
          </ScrollView>
        ) : null}
        {sheet === "createTopicCustom" ? (
          <View style={styles.customStep}>
            <Text style={styles.inputLabel}>Topic</Text>
            <AiTextEditor accessibilityLabel="Book topic" autoFocus editable={briefTransformation?.target !== "topic"} maxLength={2_000} multiline onChangeText={(topic) => setDraft((current) => ({ ...current, topic }))} onOpenActions={() => openBriefEditorActions("topic")} placeholder="What should this book explore?" style={styles.customTextArea} textAlignVertical="top" transformation={briefTransformation?.target === "topic" ? briefTransformation.action : undefined} value={draft.topic} />
          </View>
        ) : null}
        {sheet === "createGoal" ? (
          <ScrollView contentContainerStyle={styles.suggestionStep} showsVerticalScrollIndicator={false}>
            <View style={styles.suggestionList}>
              {!goalSuggestionsMutation.isPending && goalSuggestions.length ? <Button onPress={() => setSheet("createGoalCustom")} shape="pill" size="md" style={styles.suggestionPill} variant="secondary">Custom</Button> : null}
              {goalSuggestionsMutation.isPending ? Array.from({ length: 3 }, (_, index) => <Skeleton key={index} style={styles.suggestionLoadingPill} />) : goalSuggestions.map((goal) => <Button contentMode="raw" key={goal} onPress={() => openKnowledgeStep(goal)} shape="pill" size="md" style={styles.suggestionPill} variant="secondary"><Text numberOfLines={1} style={styles.suggestionText}>{goal}</Text></Button>)}
            </View>
            {goalSuggestionsError ? <Text accessibilityRole="alert" style={styles.noticeText}>{goalSuggestionsError}</Text> : null}
          </ScrollView>
        ) : null}
        {sheet === "createGoalCustom" ? (
          <View style={styles.customStep}>
            <Text style={styles.inputLabel}>Goal</Text>
            <AiTextEditor accessibilityLabel="Reading goal" autoFocus editable={briefTransformation?.target !== "goal"} maxLength={2_000} multiline onChangeText={(goal) => setDraft((current) => ({ ...current, goal }))} onOpenActions={() => openBriefEditorActions("goal")} placeholder="What should change after reading it?" style={styles.customTextArea} textAlignVertical="top" transformation={briefTransformation?.target === "goal" ? briefTransformation.action : undefined} value={draft.goal} />
          </View>
        ) : null}
        {sheet === "createKnowledge" ? (
          <View style={styles.customStep}>
            <Text style={styles.formLabel}>What you already know (Optional)</Text>
            <TextInput accessibilityLabel="Current knowledge" autoFocus maxLength={2_000} multiline onChangeText={(currentKnowledge) => setDraft((current) => ({ ...current, currentKnowledge }))} placeholder="Share any experience or context, or leave this blank" style={styles.stepTextArea} textAlignVertical="top" value={draft.currentKnowledge} />
            <View style={styles.footer}>
              <Button onPress={() => setSheet("createDetails")} size="md" style={styles.footerButton} variant="primary">Next</Button>
              <Button onPress={() => setSheet("createGoal")} size="md" style={styles.footerButton} variant="secondary">Close</Button>
            </View>
          </View>
        ) : null}
        {sheet === "createDetails" ? (
          <ScrollView
            contentContainerStyle={styles.form}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            <Text style={styles.formHeading}>Fine-tune your book.</Text>
            <Text style={styles.formLabel}>Book depth</Text>
            <Tabs accessibilityLabel="Book depth" accessibilityRole="tablist" style={styles.detailTabs}>
              {CHAPTER_OPTIONS.map((option) => (
                <Button
                  accessibilityRole="tab"
                  accessibilityState={{
                    selected: draft.chapterCount === option.count,
                  }}
                  key={option.count}
                  onPress={() =>
                    setDraft((current) => ({
                      ...current,
                      chapterCount: option.count,
                    }))
                  }
                  size="xs"
                  style={styles.detailTab}
                  variant={
                    draft.chapterCount === option.count
                      ? "secondary"
                      : "ghost"
                  }
                >
                  {option.label}
                </Button>
              ))}
            </Tabs>
            <Text style={styles.helper}>{draft.chapterCount} chapters</Text>
            <Text style={styles.formLabel}>Language</Text>
            <Tabs accessibilityLabel="Common book languages" accessibilityRole="tablist" style={styles.languageTabs}>
              {LANGUAGES.map((language) => (
                <Button
                  accessibilityRole="tab"
                  accessibilityState={{ selected: draft.language === language }}
                  key={language}
                  onPress={() => setDraft((current) => ({ ...current, language }))}
                  size="xs"
                  style={styles.languageTab}
                  variant={draft.language === language ? "secondary" : "ghost"}
                >
                  {language}
                </Button>
              ))}
            </Tabs>
            <TextInput
              accessibilityLabel="Book language"
              onChangeText={(language) =>
                setDraft((current) => ({ ...current, language }))
              }
              placeholder="Or enter another language"
              value={draft.language}
            />
            <Text style={styles.formLabel}>Writing tone</Text>
            <View style={styles.sheetList}>
              {TONES.map((writingTone) => (
                <Button
                  accessibilityState={{
                    selected: draft.writingTone === writingTone,
                  }}
                  key={writingTone}
                  onPress={() =>
                    setDraft((current) => ({ ...current, writingTone }))
                  }
                  size="md"
                  variant={
                    draft.writingTone === writingTone ? "primary" : "secondary"
                  }
                >
                  {writingTone}
                </Button>
              ))}
            </View>
            <Text style={styles.formLabel}>Archive sources</Text>
            <Button
              icon={<FileIcon size="sm" />}
              onPress={() => setSheet("sources")}
              size="md"
              variant="secondary"
            >
              {draft.archiveDocumentKeys.length
                ? `${draft.archiveDocumentKeys.length} selected`
                : "Choose documents"}
            </Button>
            <Text style={styles.helper}>
              No Archive document is selected automatically.
            </Text>
            <View style={styles.switchRow}>
              <View style={styles.switchCopy}>
                <Text style={styles.voiceName}>Chapter images</Text>
                <Text style={styles.helper}>
                  Generate an image for each chapter.
                </Text>
              </View>
              <Switch
                accessibilityLabel="Generate chapter images"
                checked={draft.chapterImages}
                onCheckedChange={(chapterImages) =>
                  setDraft((current) => ({ ...current, chapterImages }))
                }
              />
            </View>
            <Text style={styles.formLabel}>Additional instructions (Optional)</Text>
            <TextInput
              accessibilityLabel="Additional instructions"
              multiline
              onChangeText={(additionalInstructions) =>
                setDraft((current) => ({ ...current, additionalInstructions }))
              }
              placeholder="Optional constraints, examples, or emphasis"
              style={styles.textArea}
              value={draft.additionalInstructions}
            />
            {draftError ? (
              <Text
                accessibilityLiveRegion="assertive"
                accessibilityRole="alert"
                style={styles.failed}
              >
                {draftError}
              </Text>
            ) : null}
            <View style={styles.footer}>
              <Button
                disabled={
                  draft.topic.trim().length < 3 ||
                  draft.goal.trim().length < 3 ||
                  draft.language.trim().length < 2
                }
                onPress={submit}
                size="md"
                style={styles.footerButton}
                variant="primary"
              >
                Create book
              </Button>
              <Button
                onPress={() => {
                  setDraft(INITIAL_DRAFT);
                  setDraftError(undefined);
                  setSheetOpen(false);
                  setSheet(undefined);
                }}
                size="md"
                style={styles.footerButton}
                variant="secondary"
              >
                Discard
              </Button>
            </View>
          </ScrollView>
        ) : null}
        {sheet === "sources" ? (
          <View style={styles.sourcePicker}>
            <View style={styles.chapterSearch}>
              <SearchIcon size="sm" variant="muted" />
              <TextInput
                accessibilityLabel="Search all Archive documents"
                onChangeText={setDocumentQuery}
                placeholder="Search all documents"
                style={styles.rootSearchInput}
                value={documentQuery}
              />
            </View>
            {!documentQuery.trim() && archiveFolderKey ? (
              <Button
                icon={<ChevronLeftIcon size="sm" />}
                onPress={() => setArchiveFolderKey(archiveStack.at(-2)?.key)}
                size="md"
                variant="secondary"
              >
                {archiveStack.length > 1
                  ? archiveStack.at(-2)!.name
                  : "Archive"}
              </Button>
            ) : null}
            {folderTreeQuery.error || documentsQuery.error ? (
              <View accessibilityRole="alert" style={styles.queryError}>
                <Text style={styles.noticeText}>
                  Archive documents could not be loaded.
                </Text>
                <Button
                  onPress={() => {
                    void folderTreeQuery.refetch();
                    void documentsQuery.refetch();
                  }}
                  size="md"
                  variant="secondary"
                >
                  Retry
                </Button>
              </View>
            ) : null}
            <ScrollView contentContainerStyle={styles.documentList}>
              {documentsQuery.isPending ? (
                Array.from({ length: 4 }, (_, index) => (
                  <Skeleton key={index} style={styles.documentSkeleton} />
                ))
              ) : (
                <>
                  {documentsQuery.data?.folders.map((folder) => (
                    <Button
                      accessibilityLabel={`Open folder ${folder.name}`}
                      contentMode="raw"
                      key={folder.key}
                      onPress={() => {
                        setDocumentQuery("");
                        setArchiveFolderKey(folder.key);
                      }}
                      size="md"
                      style={styles.document}
                      variant="secondary"
                    >
                      <FolderIcon size="md" variant="muted" />
                      <View style={styles.voiceCopy}>
                        <Text numberOfLines={1} style={styles.voiceName}>
                          {folder.name}
                        </Text>
                        <Text style={styles.voiceDescription}>FOLDER</Text>
                      </View>
                      <ChevronRightIcon size="sm" />
                    </Button>
                  ))}
                  {documentsQuery.data?.documents.map((document) => {
                    const selected = draft.archiveDocumentKeys.includes(
                      document.key,
                    );
                    return (
                      <Button
                        accessibilityLabel={`${selected ? "Deselect" : "Select"} ${document.name}`}
                        accessibilityState={{ selected }}
                        contentMode="raw"
                        key={document.key}
                        onPress={() => toggleDocument(document)}
                        size="md"
                        style={[styles.document, selected && styles.selected]}
                        variant="secondary"
                      >
                        <FileIcon
                          size="md"
                          variant={selected ? "accent" : "muted"}
                        />
                        <View style={styles.voiceCopy}>
                          <Text numberOfLines={1} style={styles.voiceName}>
                            {document.name}
                          </Text>
                          <Text style={styles.voiceDescription}>
                            {document.extension?.toUpperCase() || "DOCUMENT"}
                          </Text>
                        </View>
                        {selected ? (
                          <CheckIcon size="sm" variant="accent" />
                        ) : null}
                      </Button>
                    );
                  })}
                </>
              )}
            </ScrollView>
            {draftError ? (
              <Text
                accessibilityLiveRegion="assertive"
                accessibilityRole="alert"
                style={styles.failed}
              >
                {draftError}
              </Text>
            ) : null}
            <View style={styles.footer}>
              <Button
                onPress={() => setSheet("createDetails")}
                size="md"
                style={styles.footerButton}
                variant="primary"
              >
                Done · {draft.archiveDocumentKeys.length} selected
              </Button>
              <Button
                onPress={() => {
                  setDraft((current) => ({
                    ...current,
                    archiveDocumentKeys: [],
                  }));
                  setDraftError(undefined);
                }}
                size="md"
                style={styles.footerButton}
                variant="secondary"
              >
                Clear
              </Button>
            </View>
          </View>
        ) : null}
        {sheet === "bookActions" && selectedBook ? (
          <View style={styles.sheetList}>
            <Text accessibilityLiveRegion="polite" style={styles.actionStatus}>
              {statusLabel(selectedBook.status)}
              {selectedBook.generationProgressPercent === undefined
                ? ""
                : ` · ${Math.round(selectedBook.generationProgressPercent)}%`}
              {selectedBook.failureMessage
                ? `: ${selectedBook.failureMessage}`
                : ""}
            </Text>
            {lifecycleError ? (
              <Text accessibilityRole="alert" style={styles.failed}>
                {lifecycleError}
              </Text>
            ) : null}
            {selectedBook.status === "failed" ? (
              <Button
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
                size="md"
                variant="primary"
              >
                Retry generation
              </Button>
            ) : null}
            {ACTIVE_STATUSES.includes(selectedBook.status) ? (
              <Button
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
                size="md"
                variant="secondary"
              >
                Cancel generation
              </Button>
            ) : null}
            <Button
              disabled={
                lifecycleMutation.isPending ||
                selectedBook.key.startsWith("pending-")
              }
              icon={<TrashIcon size="sm" />}
              onPress={() => setSheet("delete")}
              size="md"
              variant="secondary"
            >
              Delete book
            </Button>
            <Button
              onPress={() => setSheetOpen(false)}
              size="md"
              variant="secondary"
            >
              Close
            </Button>
          </View>
        ) : null}
        {sheet === "delete" && selectedBook ? (
          <View style={styles.sheetList}>
            <Text style={styles.actionStatus}>
              This permanently deletes “{selectedBook.title}” and its reading
              progress.
            </Text>
            <Button
              disabled={lifecycleMutation.isPending}
              loading={lifecycleMutation.isPending}
              onPress={() =>
                lifecycleMutation.mutate({
                  action: "delete",
                  book: selectedBook,
                })
              }
              size="md"
              variant="primary"
            >
              Delete
            </Button>
            <Button
              disabled={lifecycleMutation.isPending}
              onPress={() => setSheet("bookActions")}
              size="md"
              variant="secondary"
            >
              Close
            </Button>
          </View>
        ) : null}
        {sheet === "reader" && playback.detail ? (
          <Reader
            audio={playback.audio}
            chapter={playback.chapter}
            chapterIndex={playback.chapterIndex}
            currentTime={playback.currentTime}
            detail={playback.detail}
            duration={playback.duration}
            onBack={() => { setSheetOpen(false); setSheet(undefined); }}
            onMoveChapter={(offset) => void playback.moveChapter(offset)}
            onRefreshUrl={() => void playback.refreshUrl()}
            onSeek={playback.seek}
            onSleep={() => setSheet("sleep")}
            onSpeed={() => {
              const index = SPEEDS.indexOf(
                playback.speed as (typeof SPEEDS)[number],
              );
              playback.setSpeed(SPEEDS[(index + 1) % SPEEDS.length]!);
            }}
            onToggle={() => void playback.toggle()}
            ordered={playback.orderedChapters}
            persistenceError={playback.persistenceError}
            playbackError={playback.error}
            refreshingUrl={playback.refreshingUrl}
            sleepMinutes={playback.sleepMinutes}
            speed={playback.speed}
          />
        ) : null}
        {sheet === "reader" && !playback.detail ? (
          <View
            accessibilityRole={playback.error ? "alert" : "progressbar"}
            style={styles.detailLoading}
          >
            <Text style={styles.noticeText}>
              {playback.error ?? "Loading reader..."}
            </Text>
            {playback.error ? (
              <Button
                onPress={() => void playback.refreshUrl()}
                size="md"
                variant="secondary"
              >
                Retry
              </Button>
            ) : null}
          </View>
        ) : null}
        {sheet === "sleep" ? (
          <View style={styles.sheetList}>
            {SLEEP_MINUTES.map((minutes) => (
              <BottomSheetItem
                key={minutes}
                onPress={() => {
                  playback.setSleepMinutes(minutes);
                  setSheet("reader");
                }}
                variant={
                  playback.sleepMinutes === minutes ? "primary" : "secondary"
                }
              >
                {minutes ? `${minutes} minutes` : "Off"}
              </BottomSheetItem>
            ))}
          </View>
        ) : null}
      </BottomSheet>

      <BottomSheet hideHeading onOpenChange={(open) => { if (!open) setBriefActionTarget(undefined); }} open={Boolean(briefActionTarget)} title="AI actions">
        <View style={styles.sheetList}>
          <BottomSheetItem onPress={() => { const target = briefActionTarget; if (target) void transformBriefEditor(target, "enhance"); }} style={styles.sheetAction} variant="secondary">Enhance</BottomSheetItem>
          <BottomSheetItem onPress={openBriefEditorTranslation} style={styles.sheetAction} variant="secondary">Translate</BottomSheetItem>
        </View>
      </BottomSheet>
      <BottomSheet footer={<><Button disabled={briefTargetLanguage.trim().length < 2} onPress={() => { const target = briefTranslateTarget; if (target) void transformBriefEditor(target, "translate"); }} size="md" variant="primary">Translate</Button><Button onPress={() => setBriefTranslateTarget(undefined)} size="md" variant="secondary">Close</Button></>} height="full" onOpenChange={(open) => { if (!open) setBriefTranslateTarget(undefined); }} open={Boolean(briefTranslateTarget)} title="Translate text">
        <View style={styles.customStep}><Text style={styles.inputLabel}>Language</Text><TextInput accessibilityLabel="Book brief translation language" autoFocus maxLength={100} onChangeText={setBriefTargetLanguage} placeholder="Language" value={briefTargetLanguage} /></View>
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
  library: { flexGrow: 1, paddingHorizontal: spacing.md, paddingBottom: 140 },
  grid: {
    width: "100%",
    flexDirection: "row",
    flexWrap: "wrap",
    gap: GRID_GAP,
  },
  bookCard: {
    overflow: "hidden",
    alignItems: "stretch",
    justifyContent: "flex-end",
    padding: 0,
    borderWidth: 1,
    borderColor: palette.hairline,
    borderRadius: radii.sm,
    backgroundColor: palette.panelRaised,
  },
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
    backgroundColor: "rgba(0,0,0,0.35)",
  },
  cardCopy: { marginTop: "auto", padding: 8, gap: 3 },
  cardTitle: {
    color: palette.silver50,
    fontFamily: fonts.semibold,
    fontSize: 11,
    lineHeight: 14,
  },
  cardStatus: {
    color: palette.silver300,
    fontFamily: fonts.medium,
    fontSize: 8,
    textTransform: "uppercase",
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
  filterPanel: { gap: 6 },
  searchHistoryOption: { backgroundColor: palette.page },
  favoriteSwitchRow: { minHeight: 32, flexDirection: "row", alignItems: "center", gap: spacing.xs },
  favoriteSwitchLabel: { color: palette.muted, fontFamily: fonts.regular, fontSize: 12 },
  sheetAction: { justifyContent: "center" },
  form: { gap: spacing.sm, paddingBottom: spacing.xl },
  suggestionStep: { flex: 1, gap: spacing.md },
  suggestionList: { gap: 6 },
  suggestionPill: { width: "100%", minHeight: 40, justifyContent: "flex-start", paddingHorizontal: spacing.md },
  suggestionLoadingPill: { width: "100%", height: 40, borderRadius: 999 },
  suggestionText: { color: palette.silver100, fontFamily: fonts.regular, fontSize: 13, lineHeight: 17, textAlign: "left" },
  selectedPrompt: { color: palette.silver500, fontFamily: fonts.regular, fontSize: 12, lineHeight: 17 },
  customStep: { flex: 1, gap: spacing.sm },
  stepTextArea: { flex: 1, minHeight: 220, textAlignVertical: "top" },
  customTextArea: { minHeight: 280, paddingTop: 12, lineHeight: 22, backgroundColor: palette.page, textAlignVertical: "top" },
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
  voiceCopy: { minWidth: 0, flex: 1, alignItems: "flex-start" },
  voiceName: {
    color: palette.silver100,
    fontFamily: fonts.medium,
    fontSize: 13,
  },
  voiceDescription: {
    marginTop: 2,
    color: palette.silver500,
    fontFamily: fonts.regular,
    fontSize: 11,
  },
  selected: { borderWidth: 1, borderColor: palette.silver300 },
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
  footer: { width: "100%", gap: spacing.sm },
  footerButton: { width: "100%" },
  detailTabs: { flexDirection: "row", gap: 4, padding: 3, borderWidth: 1, backgroundColor: palette.panel },
  detailTab: { flex: 1 },
  languageTabs: { flexDirection: "row", flexWrap: "wrap", gap: 4, padding: 3, borderWidth: 1, backgroundColor: palette.panel },
  languageTab: { width: "32%" },
  actionStatus: {
    color: palette.silver300,
    fontFamily: fonts.regular,
    fontSize: 13,
    lineHeight: 19,
  },
  sourcePicker: { flex: 1, gap: spacing.sm },
  queryError: { gap: spacing.sm, padding: spacing.sm, borderWidth: 1, borderColor: palette.hairline, borderRadius: radii.md, backgroundColor: palette.panel },
  detail: { gap: spacing.lg, paddingBottom: spacing.xl },
  detailPage: { flexGrow: 1, paddingHorizontal: spacing.md, paddingBottom: 140 },
  detailHero: { flexDirection: "row", gap: spacing.md },
  detailCover: {
    width: 112,
    height: (112 * 16) / 9,
    overflow: "hidden",
    borderRadius: radii.sm,
  },
  detailCopy: {
    minWidth: 0,
    flex: 1,
    justifyContent: "center",
    alignItems: "flex-start",
    gap: spacing.sm,
  },
  detailTitle: {
    color: palette.silver50,
    fontFamily: fonts.light,
    fontSize: 24,
    lineHeight: 29,
  },
  detailMeta: {
    color: palette.silver500,
    fontFamily: fonts.regular,
    fontSize: 11,
  },
  detailLoading: { gap: spacing.md },
  detailCoverSkeleton: { width: 112, height: 199, borderRadius: radii.sm },
  detailLine: { width: "70%", height: 14, borderRadius: 7 },
  chapterSearch: {
    height: 44,
    paddingHorizontal: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    borderWidth: 1,
    borderColor: palette.hairline,
    borderRadius: 999,
    backgroundColor: palette.panel,
  },
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
  check: {
    position: "absolute",
    top: 5,
    right: 5,
    width: 20,
    height: 20,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 10,
    backgroundColor: palette.silver100,
  },
  reader: { flex: 1, marginHorizontal: -spacing.xs },
  readerHeader: {
    minHeight: 52,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  readerIdentity: { minWidth: 0, flex: 1 },
  micro: {
    color: palette.silver500,
    fontFamily: fonts.medium,
    fontSize: 8,
    letterSpacing: tracking.micro,
  },
  readerTitle: {
    marginTop: 3,
    color: palette.silver100,
    fontFamily: fonts.medium,
    fontSize: 14,
  },
  transcript: {
    flexGrow: 1,
    gap: 17,
    paddingHorizontal: spacing.sm,
    paddingTop: spacing.md,
    paddingBottom: 210,
  },
  phrase: {
    color: palette.silver500,
    fontFamily: fonts.regular,
    fontSize: 20,
    lineHeight: 29,
    opacity: 0.6,
  },
  activePhrase: {
    color: palette.silver50,
    fontSize: 23,
    lineHeight: 32,
    opacity: 1,
  },
  pastPhrase: { color: palette.silver700, opacity: 0.45 },
  chapterBody: {
    color: palette.silver300,
    fontFamily: fonts.regular,
    fontSize: 17,
    lineHeight: 28,
  },
  playerPanel: {
    position: "absolute",
    right: 0,
    bottom: 0,
    left: 0,
    padding: spacing.sm,
    gap: 5,
    borderTopWidth: 1,
    borderColor: palette.hairline,
    borderRadius: radii.md,
    backgroundColor: palette.panelRaised,
  },
  playerNotice: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  noticeText: {
    minWidth: 0,
    flex: 1,
    color: palette.silver300,
    fontFamily: fonts.regular,
    fontSize: 12,
  },
  buffering: {
    color: palette.silver500,
    fontFamily: fonts.regular,
    fontSize: 10,
    textAlign: "center",
  },
  persistenceNotice: { color: palette.silver500, fontFamily: fonts.regular, fontSize: 10, lineHeight: 14 },
  timeRow: { flexDirection: "row", justifyContent: "space-between" },
  time: { color: palette.silver500, fontFamily: fonts.regular, fontSize: 9 },
  playbackRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 5,
  },
  playButton: { width: 44, paddingHorizontal: 0 },
  secondaryControls: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  readerBook: {
    minWidth: 0,
    flex: 1,
    color: palette.silver500,
    fontFamily: fonts.regular,
    fontSize: 11,
    textAlign: "right",
  },
  documentList: { gap: spacing.sm, paddingVertical: spacing.md },
  document: {
    width: "100%",
    minHeight: 58,
    justifyContent: "flex-start",
    gap: spacing.sm,
  },
  documentSkeleton: { width: "100%", height: 58, borderRadius: radii.md },
});
