import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { AudioStatus } from "expo-audio";
import { randomUUID } from "expo-crypto";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { useEffect, useRef, useState } from "react";
import {
  AccessibilityInfo,
  KeyboardAvoidingView,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  BottomSheet,
  BottomSheetItem,
} from "@vorinthex/shared/ui/bottom-sheet";
import { Button } from "@vorinthex/shared/ui/button";
import { CoreComposer } from "@vorinthex/shared/ui/core-composer";
import { Slider } from "@vorinthex/shared/ui/slider";
import { Skeleton } from "@vorinthex/shared/ui/skeleton";
import { Switch } from "@vorinthex/shared/ui/switch";
import { TextInput } from "@vorinthex/shared/ui/text-input";
import { useToast } from "@vorinthex/shared/ui/toast";
import {
  AscendIcon,
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
import { WorkspaceAppSwitcher } from "@/components/capability/WorkspaceAppSwitcher";
import { assistantIconSource } from "@/data/capability-icons";
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
  type Book,
  type BookChapter,
  type BookDetail,
  type BookStatus,
  type CreateBookInput,
  type NarratorVoice,
} from "@/lib/books-client";
import {
  getContentContext,
  listContentFolderTree,
  searchContentMatches,
  type ContentDocument,
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
const STATUS_FILTERS: (BookStatus | "all")[] = [
  "all",
  "queued",
  "researching",
  "planning",
  "writing",
  "narrating",
  "finalizing",
  "failed",
  "cancelled",
  "ready",
];
const CHAPTER_OPTIONS = [
  { count: 10, label: "Short · 10 chapters" },
  { count: 25, label: "Standard · 25 chapters" },
  { count: 50, label: "Deep · 50 chapters" },
] as const;
const SPEEDS = [0.75, 1, 1.25, 1.5, 2] as const;
const SLEEP_MINUTES = [0, 10, 20, 30, 45, 60] as const;
const MAX_SOURCE_DOCUMENTS = 50;
const VOICES: NarratorVoice[] = [
  { key: "calm", name: "Calm", description: "Measured and reflective" },
  { key: "clear", name: "Clear", description: "Direct and conversational" },
  { key: "warm", name: "Warm", description: "Friendly and expressive" },
];
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
  | "sources"
  | "filter"
  | "detail"
  | "reader"
  | "sleep"
  | "bookActions"
  | "delete";
type Draft = CreateBookInput;
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
  narratorVoiceKey: VOICES[0]!.key,
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
      style={[styles.cover, styles.fallbackCover]}
    >
      <AscendIcon size="md" variant="muted" />
      <Text numberOfLines={4} style={styles.coverTitle}>
        {book.title}
      </Text>
    </LinearGradient>
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
  const [gridWidth, setGridWidth] = useState(0);
  const [chapterGridWidth, setChapterGridWidth] = useState(0);
  const [sheet, setSheet] = useState<LibrarySheet>();
  const [sheetOpen, setSheetOpen] = useState(false);
  const [selectedBookKey, setSelectedBookKey] = useState<string>();
  const [query, setQuery] = useState("");
  const [chapterQuery, setChapterQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<BookStatus | "all">("all");
  const [draft, setDraft] = useState<Draft>(INITIAL_DRAFT);
  const [archiveFolderKey, setArchiveFolderKey] = useState<string>();
  const [documentQuery, setDocumentQuery] = useState("");
  const [assistantInput, setAssistantInput] = useState("");
  const [assistantMessage, setAssistantMessage] = useState<string>();
  const [lifecycleError, setLifecycleError] = useState<string>();
  const [draftError, setDraftError] = useState<string>();
  const assistantRequestKey = useRef<string | undefined>(undefined);
  const failedCreate = useRef<FailedBookCreate | undefined>(undefined);

  const overviewQuery = useQuery({
    queryKey: ascendQueryKeys.overview(context),
    queryFn: fetchBooksOverview,
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
      (statusFilter === "all" || book.status === statusFilter) &&
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
        narrator: VOICES.find(({ key }) => key === input.narratorVoiceKey),
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
        setSheet("create");
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

  function open(next: LibrarySheet) {
    setSheet(next);
    setSheetOpen(true);
  }
  function beginCreate() {
    setDraft(INITIAL_DRAFT);
    setDraftError(undefined);
    setDocumentQuery("");
    setArchiveFolderKey(undefined);
    open("create");
  }
  function submit() {
    if (
      draft.topic.trim().length < 3 ||
      draft.goal.trim().length < 3 ||
      draft.currentKnowledge.trim().length < 2 ||
      draft.language.trim().length < 2
    ) {
      setDraftError(
        "Complete the topic, goal, current knowledge, and language before creating your book.",
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
    if (book.key.startsWith("pending-") || book.status !== "ready")
      open("bookActions");
    else open("detail");
  }
  function startReader(chapterKey?: string) {
    if (!detail) return;
    const nextChapterKey =
      chapterKey ??
      detail.book.currentChapterKey ??
      detail.chapters.find(({ isCompleted }) => !isCompleted)?.key;
    setSheet("reader");
    if (!nextChapterKey) {
      showToast({
        title: "This book has no available chapter to play.",
        duration: 2_500,
      });
      return;
    }
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
      setSheet("reader");
      setSheetOpen(true);
    });
    return () => cancelAnimationFrame(frame);
  }, [playback.playbackBookKey, playback.readerRequest]);

  const chapters =
    detail?.chapters.filter((chapter) =>
      `${chapter.position} ${chapter.title} ${chapter.description}`
        .toLowerCase()
        .includes(chapterQuery.trim().toLowerCase()),
    ) ?? [];
  const sheetTitle =
    sheet === "actions"
      ? "New in Ascend"
      : sheet === "create"
        ? "Create book"
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
    <KeyboardAvoidingView behavior="height" style={styles.root}>
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
            !((sheet === "create" || sheet === "sources") && sheetOpen && dirty)
          }
        />
      </View>
      <View style={styles.localHeader}>
        <Text style={styles.localTitle}>Ascend</Text>
        <Button
          accessibilityLabel="New book"
          contentMode="raw"
          onPress={() => open("actions")}
          size="md"
          variant="icon"
        >
          <PlusIcon size="sm" />
        </Button>
      </View>
      <View style={styles.searchRow}>
        <View style={styles.searchPill}>
          <SearchIcon size="sm" variant="muted" />
          <TextInput
            accessibilityLabel="Search books"
            onChangeText={setQuery}
            placeholder="Search books"
            style={styles.searchInput}
            value={query}
          />
          {query ? (
            <Button
              accessibilityLabel="Clear book search"
              contentMode="raw"
              onPress={() => setQuery("")}
              size="xs"
              variant="secondary"
            >
              <CloseIcon size="sm" />
            </Button>
          ) : null}
        </View>
        <Button
          accessibilityLabel="Filter books"
          contentMode="raw"
          onPress={() => open("filter")}
          size="sm"
          style={styles.filterButton}
          variant="icon"
        >
          <FilterIcon
            size="sm"
            variant={statusFilter === "all" ? "default" : "accent"}
          />
        </Button>
      </View>
      <ScrollView
        contentContainerStyle={styles.library}
        showsVerticalScrollIndicator={false}
      >
        {overviewQuery.isPending ? (
          <View
            accessibilityLabel="Loading books"
            accessibilityRole="progressbar"
            onLayout={({ nativeEvent }) =>
              setGridWidth(nativeEvent.layout.width)
            }
            style={styles.grid}
          >
            {Array.from({ length: COLUMNS }, (_, index) => (
              <Skeleton
                key={index}
                style={{
                  width: cardWidth,
                  height: (cardWidth * 16) / 9,
                  borderRadius: radii.sm,
                }}
              />
            ))}
          </View>
        ) : overviewQuery.error ? (
          <View style={styles.state}>
            <Text style={styles.stateTitle}>Books could not be loaded.</Text>
            <Button
              onPress={() => void overviewQuery.refetch()}
              size="sm"
              variant="secondary"
            >
              Retry
            </Button>
          </View>
        ) : (
          <View
            onLayout={({ nativeEvent }) =>
              setGridWidth(nativeEvent.layout.width)
            }
            style={styles.grid}
          >
            {filteredBooks.map((book, index) => (
              <Button
                accessibilityLabel={`${book.title}, ${statusLabel(book.status)}${book.failureMessage ? `, ${book.failureMessage}` : ""}`}
                accessibilityRole="button"
                contentMode="raw"
                key={book.key}
                onPress={() => chooseBook(book)}
                size="md"
                style={[
                  styles.bookCard,
                  { width: cardWidth, height: (cardWidth * 16) / 9 },
                ]}
                variant="ghost"
              >
                <Cover book={book} index={index} />
                <View style={styles.cardShade} />
                <View style={styles.cardCopy}>
                  <Text numberOfLines={3} style={styles.cardTitle}>
                    {book.title}
                  </Text>
                  <Text
                    numberOfLines={2}
                    style={[
                      styles.cardStatus,
                      book.status === "failed" && styles.failed,
                    ]}
                  >
                    {book.status === "ready"
                      ? `${Math.round(book.progressPercent)}% read`
                      : book.failureMessage
                        ? `${statusLabel(book.status)} · ${book.failureMessage}`
                        : `${statusLabel(book.status)}${book.generationProgressPercent === undefined ? "" : ` ${Math.round(book.generationProgressPercent)}%`}`}
                  </Text>
                  {ACTIVE_STATUSES.includes(book.status) ? (
                    <View
                      accessibilityLabel={`${Math.round(book.generationProgressPercent ?? 0)} percent generated`}
                      accessibilityRole="progressbar"
                      accessibilityValue={{
                        min: 0,
                        max: 100,
                        now: Math.round(book.generationProgressPercent ?? 0),
                      }}
                      style={styles.generationTrack}
                    >
                      <View
                        style={[
                          styles.generationFill,
                          { width: `${book.generationProgressPercent ?? 0}%` },
                        ]}
                      />
                    </View>
                  ) : null}
                </View>
              </Button>
            ))}
          </View>
        )}
        {!overviewQuery.isPending &&
        !overviewQuery.error &&
        filteredBooks.length === 0 ? (
          <View style={styles.state}>
            <AscendIcon size="lg" variant="muted" />
            <Text style={styles.stateTitle}>
              {books.length
                ? "No books match this view."
                : "Your first book starts with an idea."}
            </Text>
            <Button onPress={beginCreate} size="sm" variant="primary">
              Create book
            </Button>
          </View>
        ) : null}
      </ScrollView>
      <CoreComposer
        accessibilityLabel="Ask Core about Ascend"
        disabled={assistantMutation.isPending}
        editable={!assistantMutation.isPending}
        leading={
          <ChromeIcon glow={0.35} size={24} source={assistantIconSource} />
        }
        loading={assistantMutation.isPending}
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
        onSubmit={askAssistant}
        prompts={CORE_PROMPTS}
        sendIcon={<SendIcon size="sm" variant="inverse" />}
        value={assistantInput}
      />

      <BottomSheet
        description={
          sheet === "create"
            ? "Nothing personal is included unless you select it."
            : sheet === "sources"
              ? "Only documents you explicitly choose are included."
              : undefined
        }
        dismissible={(sheet !== "create" && sheet !== "sources") || !dirty}
        headerLeading={
          sheet === "sources" ? (
            <Button
              accessibilityLabel="Back to book creation"
              contentMode="raw"
              onPress={() => setSheet("create")}
              size="md"
              variant="icon"
            >
              <ChevronLeftIcon size="sm" />
            </Button>
          ) : undefined
        }
        height={
          ["create", "sources", "detail", "reader", "sleep"].includes(
            sheet ?? "",
          )
            ? "full"
            : undefined
        }
        onOpenChange={(next) => {
          setSheetOpen(next);
          if (!next) setSheet(undefined);
        }}
        open={sheetOpen}
        pageKey={sheet}
        title={sheetTitle}
      >
        {sheet === "actions" ? (
          <BottomSheetItem
            icon={<AscendIcon size="md" />}
            onPress={beginCreate}
          >
            Create book
          </BottomSheetItem>
        ) : null}
        {sheet === "filter" ? (
          <View style={styles.sheetList}>
            {STATUS_FILTERS.map((status) => (
              <Button
                accessibilityState={{ selected: statusFilter === status }}
                key={status}
                onPress={() => {
                  setStatusFilter(status);
                  setSheetOpen(false);
                }}
                size="md"
                variant={statusFilter === status ? "primary" : "secondary"}
              >
                {status === "all" ? "All books" : statusLabel(status)}
              </Button>
            ))}
          </View>
        ) : null}
        {sheet === "create" ? (
          <ScrollView
            contentContainerStyle={styles.form}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            <Text style={styles.formHeading}>
              Build a book around your outcome.
            </Text>
            <Text style={styles.formLabel}>TOPIC</Text>
            <TextInput
              accessibilityLabel="Book topic"
              multiline
              onChangeText={(topic) =>
                setDraft((current) => ({ ...current, topic }))
              }
              placeholder="What should this book explore?"
              style={styles.textArea}
              value={draft.topic}
            />
            <Text style={styles.formLabel}>GOAL</Text>
            <TextInput
              accessibilityLabel="Reading goal"
              multiline
              onChangeText={(goal) =>
                setDraft((current) => ({ ...current, goal }))
              }
              placeholder="What should change after reading it?"
              style={styles.textArea}
              value={draft.goal}
            />
            <Text style={styles.formLabel}>WHAT YOU ALREADY KNOW</Text>
            <TextInput
              accessibilityLabel="Current knowledge"
              multiline
              onChangeText={(currentKnowledge) =>
                setDraft((current) => ({ ...current, currentKnowledge }))
              }
              placeholder="Start from the right level"
              style={styles.textArea}
              value={draft.currentKnowledge}
            />
            <Text style={styles.formLabel}>BOOK DEPTH</Text>
            <View style={styles.sheetList}>
              {CHAPTER_OPTIONS.map((option) => (
                <Button
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
                  size="md"
                  variant={
                    draft.chapterCount === option.count
                      ? "primary"
                      : "secondary"
                  }
                >
                  {option.label}
                </Button>
              ))}
            </View>
            <Text style={styles.formLabel}>LANGUAGE</Text>
            <TextInput
              accessibilityLabel="Book language"
              onChangeText={(language) =>
                setDraft((current) => ({ ...current, language }))
              }
              placeholder="English"
              value={draft.language}
            />
            <Text style={styles.formLabel}>WRITING TONE</Text>
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
            <Text style={styles.formLabel}>NARRATOR</Text>
            <View style={styles.voiceGrid}>
              {VOICES.map((voice) => (
                <Button
                  accessibilityState={{
                    selected: draft.narratorVoiceKey === voice.key,
                  }}
                  contentMode="raw"
                  key={voice.key}
                  onPress={() =>
                    setDraft((current) => ({
                      ...current,
                      narratorVoiceKey: voice.key,
                    }))
                  }
                  size="md"
                  style={[
                    styles.voice,
                    draft.narratorVoiceKey === voice.key && styles.selected,
                  ]}
                  variant="secondary"
                >
                  <VolumeIcon
                    size="sm"
                    variant={
                      draft.narratorVoiceKey === voice.key ? "accent" : "muted"
                    }
                  />
                  <View style={styles.voiceCopy}>
                    <Text style={styles.voiceName}>{voice.name}</Text>
                    <Text style={styles.voiceDescription}>
                      {voice.description}
                    </Text>
                  </View>
                  {voice.previewUrl ? <PlayIcon size="sm" /> : null}
                </Button>
              ))}
            </View>
            <Text style={styles.formLabel}>NARRATION PACE</Text>
            <Slider
              accessibilityLabel="Narration pace"
              max={2}
              min={0.75}
              onValueChange={(narrationPace) =>
                setDraft((current) => ({
                  ...current,
                  narrationPace: Math.round(narrationPace * 20) / 20,
                }))
              }
              value={draft.narrationPace}
            />
            <Text style={styles.valueLabel}>
              {draft.narrationPace.toFixed(2)}x
            </Text>
            <Text style={styles.formLabel}>ARCHIVE SOURCES</Text>
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
            <Text style={styles.formLabel}>ADDITIONAL INSTRUCTIONS</Text>
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
              <Button
                disabled={
                  draft.topic.trim().length < 3 ||
                  draft.goal.trim().length < 3 ||
                  draft.currentKnowledge.trim().length < 2 ||
                  draft.language.trim().length < 2
                }
                onPress={submit}
                size="md"
                style={styles.footerButton}
                variant="primary"
              >
                Create book
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
                style={styles.searchInput}
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
                onPress={() => setSheet("create")}
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
              onPress={() =>
                setSheet(
                  selectedBook.status === "ready" ? "detail" : "bookActions",
                )
              }
              size="md"
              variant="secondary"
            >
              Close
            </Button>
          </View>
        ) : null}
        {sheet === "detail" ? (
          detailQuery.isPending ? (
            <View accessibilityRole="progressbar" style={styles.detailLoading}>
              <Skeleton style={styles.detailCoverSkeleton} />
              <Skeleton style={styles.detailLine} />
              <Skeleton style={styles.detailLine} />
            </View>
          ) : detail ? (
            <ScrollView
              contentContainerStyle={styles.detail}
              showsVerticalScrollIndicator={false}
            >
              <View style={styles.detailHero}>
                <View style={styles.detailCover}>
                  <Cover book={detail.book} />
                </View>
                <View style={styles.detailCopy}>
                  <Text style={styles.detailTitle}>{detail.book.title}</Text>
                  <Text style={styles.detailMeta}>
                    {detail.book.narrator?.name ?? "Narrator"} ·{" "}
                    {detail.book.estimatedMinutes} min
                  </Text>
                  <Text style={styles.detailMeta}>
                    {Math.round(detail.book.progressPercent)}% complete
                  </Text>
                  <Button
                    icon={<PlayIcon size="sm" variant="inverse" />}
                    onPress={() => {
                      if (playback.playbackBookKey === detail.book.key) void playback.refreshUrl();
                      else startReader();
                    }}
                    size="md"
                    variant="primary"
                  >
                    {detail.book.progressPercent ? "Resume" : "Play"}
                  </Button>
                </View>
                <Button
                  accessibilityLabel="Book actions"
                  contentMode="raw"
                  onPress={() => setSheet("bookActions")}
                  size="md"
                  variant="icon"
                >
                  <MoreHorizontalIcon size="sm" />
                </Button>
              </View>
              {playback.refreshWarning ? (
                <View accessibilityRole="alert" style={styles.playerNotice}>
                  <Text style={styles.noticeText}>{playback.refreshWarning}</Text>
                  <Button
                    disabled={playback.refreshingUrl}
                    loading={playback.refreshingUrl}
                    onPress={() => startReader()}
                    size="md"
                    variant="secondary"
                  >
                    Retry
                  </Button>
                </View>
              ) : null}
              <View style={styles.chapterSearch}>
                <SearchIcon size="sm" variant="muted" />
                <TextInput
                  accessibilityLabel="Search chapters"
                  onChangeText={setChapterQuery}
                  placeholder="Search chapters"
                  style={styles.searchInput}
                  value={chapterQuery}
                />
              </View>
              <View
                onLayout={({ nativeEvent }) =>
                  setChapterGridWidth(nativeEvent.layout.width)
                }
                style={styles.grid}
              >
                {chapters.map((chapter) => (
                  <Button
                    accessibilityLabel={`Chapter ${chapter.position}, ${chapter.title}${chapter.isCompleted ? ", completed" : ""}`}
                    contentMode="raw"
                    key={chapter.key}
                    onPress={() => startReader(chapter.key)}
                    size="md"
                    style={[
                      styles.chapterCard,
                      { width: chapterWidth, height: (chapterWidth * 16) / 9 },
                    ]}
                    variant="ghost"
                  >
                    {chapter.imageUrl ? (
                      <Image
                        contentFit="cover"
                        source={chapter.imageUrl}
                        style={styles.cover}
                      />
                    ) : (
                      <LinearGradient
                        colors={
                          GRADIENTS[(chapter.position - 1) % GRADIENTS.length]!
                        }
                        style={styles.cover}
                      />
                    )}
                    <View style={styles.cardShade} />
                    <View style={styles.cardCopy}>
                      <Text style={styles.chapterNumber}>
                        {String(chapter.position).padStart(2, "0")}
                      </Text>
                      <Text numberOfLines={3} style={styles.cardTitle}>
                        {chapter.title}
                      </Text>
                      <Text style={styles.cardStatus}>
                        {chapter.isCompleted
                          ? "Completed"
                          : `${chapter.estimatedMinutes ?? Math.ceil((chapter.audioDurationSeconds ?? 0) / 60)} min`}
                      </Text>
                    </View>
                    {chapter.isCompleted ? (
                      <View style={styles.check}>
                        <CheckIcon size="sm" variant="inverse" />
                      </View>
                    ) : null}
                  </Button>
                ))}
              </View>
            </ScrollView>
          ) : (
            <View accessibilityRole="alert" style={styles.state}>
              <Text style={styles.stateTitle}>
                Book details could not be loaded.
              </Text>
              <Button
                onPress={() => void detailQuery.refetch()}
                size="md"
                variant="secondary"
              >
                Retry
              </Button>
            </View>
          )
        ) : null}
        {sheet === "reader" && playback.detail ? (
          <Reader
            audio={playback.audio}
            chapter={playback.chapter}
            chapterIndex={playback.chapterIndex}
            currentTime={playback.currentTime}
            detail={playback.detail}
            duration={playback.duration}
            onBack={() => setSheet("detail")}
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
    minHeight: 54,
    paddingHorizontal: spacing.md,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  localTitle: {
    color: palette.silver50,
    fontFamily: fonts.light,
    fontSize: 27,
    letterSpacing: -0.6,
  },
  searchRow: {
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.md,
    flexDirection: "row",
    gap: GRID_GAP,
  },
  searchPill: {
    height: 44,
    minWidth: 0,
    flex: 1,
    paddingLeft: 12,
    paddingRight: 5,
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    borderWidth: 1,
    borderColor: palette.hairline,
    borderRadius: 999,
    backgroundColor: palette.panel,
  },
  searchInput: {
    minHeight: 40,
    flex: 1,
    paddingHorizontal: 0,
    borderWidth: 0,
    backgroundColor: "transparent",
    fontSize: 13,
  },
  filterButton: { width: 44, height: 44 },
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
  fallbackCover: { padding: 10, justifyContent: "space-between" },
  coverTitle: {
    color: palette.silver50,
    fontFamily: fonts.semibold,
    fontSize: 13,
    lineHeight: 16,
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
    minHeight: 320,
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.md,
  },
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
  form: { gap: spacing.sm, paddingBottom: spacing.xl },
  formHeading: {
    marginBottom: spacing.sm,
    color: palette.silver50,
    fontFamily: fonts.light,
    fontSize: 25,
    lineHeight: 31,
  },
  formLabel: {
    marginTop: spacing.sm,
    color: palette.silver500,
    fontFamily: fonts.medium,
    fontSize: 9,
    letterSpacing: tracking.micro,
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
  footer: { flexDirection: "row", gap: spacing.sm },
  footerButton: { flex: 1 },
  actionStatus: {
    color: palette.silver300,
    fontFamily: fonts.regular,
    fontSize: 13,
    lineHeight: 19,
  },
  sourcePicker: { flex: 1, gap: spacing.sm },
  queryError: { gap: spacing.sm, padding: spacing.sm, borderWidth: 1, borderColor: palette.hairline, borderRadius: radii.md, backgroundColor: palette.panel },
  detail: { gap: spacing.lg, paddingBottom: spacing.xl },
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
