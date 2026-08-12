import { Image } from "expo-image";
import { randomUUID } from "expo-crypto";
import { LinearGradient } from "expo-linear-gradient";
import { setAudioModeAsync, useAudioPlayer, useAudioPlayerStatus } from "expo-audio";
import { useEffect, useRef, useState } from "react";
import { ScrollView, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { BottomSheet, BottomSheetItem } from "@vorinthex/shared/ui/bottom-sheet";
import { Button } from "@vorinthex/shared/ui/button";
import { TextInput } from "@vorinthex/shared/ui/text-input";
import { AscendIcon, CheckIcon, ChevronLeftIcon, PauseIcon, PlayIcon, PlusIcon, SoundwaveIcon } from "@vorinthex/shared/ui/icons-mobile";

import { WorkspaceAppSwitcher } from "@/components/capability/WorkspaceAppSwitcher";
import { BOOK_AUDIO_MODE, bookAudioMetadata } from "@/lib/book-audio";
import { createBook, fetchBookDetail, fetchBooksOverview, updateBookChapterProgress, type Book, type BookChapter, type BookDetail, type CreateBookInput } from "@/lib/books-client";
import { fonts, palette, radii, spacing, tracking } from "@/theme/tokens";

type Sheet = "actions" | "create" | "reader";
type Draft = CreateBookInput;
const INITIAL_DRAFT: Draft = { topic: "", goal: "", audience: "", tone: "", language: "English", length: "standard", sourceNotes: "" };
const STEPS = ["The idea", "The outcome", "The reader", "The voice", "Review"] as const;
const COVER_GRADIENTS = [
  ["#30363D", "#0A0E13", "#020304"],
  ["#283139", "#11161C", "#050607"],
  ["#3B3A38", "#171512", "#050504"],
] as const;

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Books could not complete that request.";
}

function formatTime(seconds: number) {
  const safe = Math.max(0, Math.floor(seconds));
  return `${Math.floor(safe / 60)}:${String(safe % 60).padStart(2, "0")}`;
}

function BookCover({ book, height, index = 0 }: { book: Book; height: number; index?: number }) {
  if (book.coverUrl) return <Image accessibilityLabel={`${book.title} cover`} contentFit="cover" source={book.coverUrl} style={[styles.cover, { height }]} transition={180} />;
  return <LinearGradient colors={COVER_GRADIENTS[index % COVER_GRADIENTS.length]!} end={{ x: 1, y: 1 }} start={{ x: 0, y: 0 }} style={[styles.cover, styles.generatedCover, { height }]}><AscendIcon size="lg" variant="muted" /><View><Text numberOfLines={4} style={styles.coverTitle}>{book.title}</Text><Text numberOfLines={2} style={styles.coverSubtitle}>{book.subtitle}</Text></View></LinearGradient>;
}

function Reader({ detail, initialChapter, onChange, onMessage }: { detail: BookDetail; initialChapter?: string; onChange: (detail: BookDetail) => void; onMessage: (message: string) => void }) {
  const ordered = [...detail.chapters].sort((a, b) => a.position - b.position);
  const [chapterKey, setChapterKey] = useState(initialChapter ?? ordered.find(({ isCompleted }) => !isCompleted)?.key ?? ordered[0]?.key);
  const chapter = ordered.find(({ key }) => key === chapterKey);
  const player = useAudioPlayer(chapter?.audioUrl ?? null, { updateInterval: 1_000, keepAudioSessionActive: true });
  const audio = useAudioPlayerStatus(player);
  const latest = useRef({ detail, chapter, seconds: chapter?.progressSeconds ?? 0, playing: false });
  const lastSaved = useRef(-1);

  useEffect(() => {
    void setAudioModeAsync(BOOK_AUDIO_MODE).catch((error: unknown) => onMessage(errorMessage(error)));
  }, [onMessage]);

  useEffect(() => {
    if (!chapter?.audioUrl) {
      player.clearLockScreenControls();
      return;
    }
    player.setActiveForLockScreen(true, bookAudioMetadata(detail.book, chapter), { showSeekBackward: true, showSeekForward: true });
    return () => player.clearLockScreenControls();
  }, [chapter, detail.book, player]);

  useEffect(() => {
    latest.current = { detail, chapter, seconds: audio.currentTime || chapter?.progressSeconds || 0, playing: audio.playing };
  }, [audio.currentTime, audio.playing, chapter, detail]);

  async function save(activeChapter = chapter, seconds = audio.currentTime, completed = false) {
    if (!activeChapter || (!activeChapter.audioUrl && !completed)) return;
    const rounded = Math.max(0, Math.floor(seconds));
    if (!completed && rounded === lastSaved.current) return;
    lastSaved.current = rounded;
    try {
      const current = latest.current.detail;
      const result = await updateBookChapterProgress(current.book.key, activeChapter.key, { progressSeconds: rounded, isCompleted: completed || activeChapter.isCompleted });
      onChange({ book: { ...result.book, coverUrl: current.book.coverUrl }, chapters: current.chapters.map((item) => item.key === result.chapter.key ? { ...result.chapter, audioUrl: item.audioUrl } : item) });
    } catch (error) {
      onMessage(errorMessage(error));
    }
  }

  useEffect(() => {
    if (!chapter?.audioUrl || !audio.isLoaded || audio.currentTime > 0 || chapter.progressSeconds <= 0) return;
    void player.seekTo(chapter.progressSeconds);
  }, [audio.currentTime, audio.isLoaded, chapter?.audioUrl, chapter?.key, chapter?.progressSeconds, player]);

  useEffect(() => {
    if (audio.didJustFinish && chapter) void save(chapter, audio.duration || chapter.audioDurationSeconds || audio.currentTime, true);
    // Completion is an edge-triggered audio status event; other status fields would retrigger this save.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [audio.didJustFinish]);

  useEffect(() => {
    const interval = setInterval(() => {
      const current = latest.current;
      if (current.playing && current.chapter && current.seconds - lastSaved.current >= 15) void save(current.chapter, current.seconds);
    }, 5_000);
    return () => {
      clearInterval(interval);
      const current = latest.current;
      if (current.chapter?.audioUrl && current.seconds > 0) void updateBookChapterProgress(current.detail.book.key, current.chapter.key, { progressSeconds: Math.floor(current.seconds), isCompleted: current.chapter.isCompleted }).catch(() => undefined);
    };
    // One timer owns the player lifecycle; current chapter/status values are read from latest.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function selectChapter(next: BookChapter) {
    if (chapter?.audioUrl && audio.currentTime > 0) await save();
    player.pause();
    lastSaved.current = -1;
    setChapterKey(next.key);
  }

  function toggleAudio() {
    if (!chapter?.audioUrl) return;
    if (audio.playing) {
      player.pause();
      void save();
    } else {
      if (audio.didJustFinish) void player.seekTo(0);
      player.play();
    }
  }

  const duration = audio.duration || chapter?.audioDurationSeconds || 0;
  const progress = duration ? Math.min(1, (audio.currentTime || chapter?.progressSeconds || 0) / duration) : 0;
  return <ScrollView contentContainerStyle={styles.reader} showsVerticalScrollIndicator={false}>
    <View style={styles.readerHero}><View style={styles.readerCover}><BookCover book={detail.book} height={220} /></View><View style={styles.readerHeroCopy}><Text style={styles.readerTitle}>{detail.book.title}</Text><Text style={styles.readerSubtitle}>{detail.book.subtitle}</Text><Text style={styles.readerDescription}>{detail.book.description}</Text><Text style={styles.readerMeta}>{detail.book.estimatedMinutes} MIN · {detail.book.chapterCount} CHAPTERS · {Math.round(detail.book.progressPercent)}% COMPLETE</Text></View></View>
    <View style={styles.readerColumns}>
       <View style={styles.chapterList}><Text style={styles.microLabel}>CHAPTERS</Text>{ordered.map((item) => <Button key={item.key} accessibilityState={{ selected: item.key === chapter?.key }} contentMode="raw" onPress={() => void selectChapter(item)} size="lg" style={[styles.chapterButton, item.key === chapter?.key && styles.chapterButtonActive]} variant="ghost"><View style={styles.chapterPosition}>{item.isCompleted ? <CheckIcon size="sm" /> : <Text style={styles.chapterNumber}>{item.position}</Text>}</View><View style={styles.chapterCopy}><Text numberOfLines={2} style={styles.chapterTitle}>{item.title}</Text><Text numberOfLines={2} style={styles.chapterDescription}>{item.description}</Text></View></Button>)}</View>
       {chapter ? <View style={styles.chapterContent}><Text style={styles.microLabel}>CHAPTER {chapter.position}</Text><Text style={styles.contentTitle}>{chapter.title}</Text><Text style={styles.contentDescription}>{chapter.description}</Text>
        {chapter.audioUrl ? <View style={styles.audioCard}><Button accessibilityLabel={audio.playing ? "Pause chapter audio" : "Play chapter audio"} contentMode="raw" onPress={toggleAudio} size="lg" variant="primary">{audio.playing ? <PauseIcon size="md" variant="inverse" /> : <PlayIcon size="md" variant="inverse" />}</Button><View style={styles.audioMain}><View style={styles.audioHeading}><SoundwaveIcon size="sm" variant={audio.playing ? "default" : "muted"} /><Text style={styles.audioLabel}>{audio.isBuffering ? "BUFFERING" : audio.playing ? "PLAYING" : audio.currentTime > 0 ? "RESUME AUDIO" : "LISTEN"}</Text></View><View style={styles.audioTrack}><View style={[styles.audioFill, { width: `${progress * 100}%` }]} /></View><Text style={styles.audioTime}>{formatTime(audio.currentTime || chapter.progressSeconds)} / {formatTime(duration)}</Text></View></View> : chapter.content ? <Button disabled={chapter.isCompleted} icon={chapter.isCompleted ? <CheckIcon size="sm" /> : undefined} onPress={() => void save(chapter, chapter.progressSeconds, true)} size="sm" variant="secondary">{chapter.isCompleted ? "Chapter completed" : "Mark chapter complete"}</Button> : null}
        <Text selectable style={styles.chapterBody}>{chapter.content ?? (detail.book.status === "ready" ? "This chapter is not available yet." : "This chapter is still being written. Return soon to continue reading.")}</Text>
      </View> : null}
    </View>
  </ScrollView>;
}

export function AscendWorkspace() {
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const columns = width >= 900 ? 5 : width >= 620 ? 4 : 3;
  const gap = 12;
  const cardWidth = Math.floor((width - spacing.md * 2 - gap * (columns - 1)) / columns);
  const [books, setBooks] = useState<Book[]>([]);
  const [detail, setDetail] = useState<BookDetail>();
  const [sheet, setSheet] = useState<Sheet>();
  const [sheetOpen, setSheetOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string>();
  const [step, setStep] = useState(0);
  const [draft, setDraft] = useState<Draft>(INITIAL_DRAFT);
  const generationRequestKey = useRef<string | undefined>(undefined);
  const dirty = Object.entries(draft).some(([key, value]) => value !== INITIAL_DRAFT[key as keyof Draft]);

  async function load() {
    setLoading(true);
    try { setBooks((await fetchBooksOverview()).books); setMessage(undefined); }
    catch (error) { setMessage(errorMessage(error)); }
    finally { setLoading(false); }
  }
  useEffect(() => {
    let active = true;
    void fetchBooksOverview().then((overview) => {
      if (!active) return;
      setBooks(overview.books);
      setMessage(undefined);
    }).catch((error: unknown) => {
      if (active) setMessage(errorMessage(error));
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => { active = false; };
  }, []);

  function open(next: Sheet) { setSheet(next); setSheetOpen(true); }
  function beginCreate() { setStep(0); setDraft(INITIAL_DRAFT); generationRequestKey.current = undefined; open("create"); }
  function valid(index = step) {
    if (index === 0) return draft.topic.trim().length >= 3;
    if (index === 1) return draft.goal.trim().length >= 3;
    if (index === 2) return draft.audience.trim().length >= 2;
    if (index === 3) return draft.tone.trim().length >= 2 && draft.language.trim().length >= 2;
    return true;
  }
  async function selectBook(book: Book) {
    setBusy(true); setMessage(undefined);
    try { const next = await fetchBookDetail(book.key); setDetail(next); open("reader"); }
    catch (error) { setMessage(errorMessage(error)); }
    finally { setBusy(false); }
  }
  async function submit() {
     setBusy(true); setMessage("Your book is being planned, written, and narrated. Keep this screen open while generation completes.");
    try {
       generationRequestKey.current ??= randomUUID();
       const created = await createBook({ ...draft, sourceNotes: draft.sourceNotes?.trim() || undefined }, generationRequestKey.current);
       setBooks((current) => [created, ...current]); setSheetOpen(false); setDraft(INITIAL_DRAFT);
       generationRequestKey.current = undefined;
       setMessage(`“${created.title}” is ready in your library.`);
    } catch (error) { setMessage(errorMessage(error)); }
    finally { setBusy(false); }
  }

  const update = (field: keyof Draft, value: string) => setDraft((current) => ({ ...current, [field]: value }));
  return <View style={styles.root}>
    <View style={[styles.header, { paddingTop: insets.top + 6 }]}><WorkspaceAppSwitcher active="ascend" onBeforeSelect={() => { if (sheet === "create" && sheetOpen && dirty) { setMessage("Finish or discard your book draft before switching apps."); return false; } return true; }} /></View>
    <ScrollView contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 48 }]} showsVerticalScrollIndicator={false}>
      <View style={styles.heading}><View><Text style={styles.eyebrow}>YOUR PRIVATE LIBRARY</Text><Text style={styles.title}>Books built around you.</Text><Text style={styles.subtitle}>Deep, personal guides designed for the outcome you want.</Text></View><Button accessibilityLabel="Create a book" contentMode="raw" disabled={busy} onPress={() => open("actions")} size="md" variant="icon"><PlusIcon size="sm" /></Button></View>
      {message ? <View accessibilityLiveRegion="polite" style={styles.message}><Text style={styles.messageText}>{message}</Text>{!loading && books.length === 0 ? <Button onPress={() => void load()} size="xs" variant="ghost">Try again</Button> : null}</View> : null}
      {loading ? <View style={styles.state}><Text style={styles.stateTitle}>Opening your library...</Text><Text style={styles.stateCopy}>Gathering books and reading progress.</Text></View> : books.length === 0 ? <View style={styles.state}><AscendIcon size="lg" variant="muted" /><Text style={styles.stateTitle}>Your first book starts with an idea.</Text><Text style={styles.stateCopy}>Turn a question, ambition, or body of notes into a guide written for you.</Text><Button onPress={beginCreate} size="sm" variant="primary">Create your first book</Button></View> : <View style={[styles.grid, { gap }]}>{books.map((book, index) => <Button key={book.key} accessibilityLabel={`${book.title}, ${Math.round(book.progressPercent)} percent complete`} contentMode="raw" disabled={busy} onPress={() => void selectBook(book)} size="xl" style={[styles.bookCard, { width: cardWidth }]} variant="ghost"><BookCover book={book} height={Math.round(cardWidth * 1.48)} index={index} /><Text numberOfLines={2} style={styles.bookTitle}>{book.title}</Text><Text numberOfLines={1} style={styles.bookMeta}>{book.status === "ready" ? `${book.estimatedMinutes} min · ${Math.round(book.progressPercent)}%` : book.status}</Text></Button>)}</View>}
    </ScrollView>
    <BottomSheet description={sheet === "create" ? `${STEPS[step]} · Step ${step + 1} of ${STEPS.length}` : sheet === "reader" ? detail?.book.subtitle : undefined} dismissible={sheet !== "create" || !dirty} mutation={sheet === "create"} onOpenChange={setSheetOpen} open={sheetOpen} tall={sheet === "reader"} title={sheet === "actions" ? "New in Ascend" : sheet === "create" ? "Create your book" : detail?.book.title ?? "Book"}>
      {sheet === "actions" ? <BottomSheetItem icon={<AscendIcon size="md" />} onPress={beginCreate} size="lg">Create book</BottomSheetItem> : null}
      {sheet === "create" ? <View style={styles.wizard}><View style={styles.progressRow}>{STEPS.map((_, index) => <View key={index} style={[styles.progressSegment, index <= step && styles.progressSegmentActive]} />)}</View><ScrollView contentContainerStyle={styles.form} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        {step === 0 ? <><Text style={styles.question}>What should this book explore?</Text><Text style={styles.prompt}>Share the topic, rough idea, or question. Broad is fine.</Text><TextInput autoFocus accessibilityLabel="Book topic or idea" multiline onChangeText={(value) => update("topic", value)} placeholder="I want to understand how to..." style={styles.largeInput} value={draft.topic} /></> : null}
        {step === 1 ? <><Text style={styles.question}>What should change after reading it?</Text><Text style={styles.prompt}>Describe the goal, decision, skill, or outcome this book should support.</Text><TextInput autoFocus accessibilityLabel="Book goal or outcome" multiline onChangeText={(value) => update("goal", value)} placeholder="By the end, I want to be able to..." style={styles.largeInput} value={draft.goal} /></> : null}
        {step === 2 ? <><Text style={styles.question}>Who is the reader?</Text><Text style={styles.prompt}>Include their prior knowledge so the book starts at the right level.</Text><TextInput autoFocus accessibilityLabel="Audience and prior knowledge" multiline onChangeText={(value) => update("audience", value)} placeholder="A curious beginner who already knows..." style={styles.largeInput} value={draft.audience} /></> : null}
        {step === 3 ? <><Text style={styles.question}>How should it sound?</Text><Text style={styles.prompt}>Choose a voice or tone, then the language to write in.</Text><TextInput autoFocus accessibilityLabel="Voice and tone" onChangeText={(value) => update("tone", value)} placeholder="Warm, rigorous, direct..." value={draft.tone} /><TextInput accessibilityLabel="Book language" onChangeText={(value) => update("language", value)} placeholder="English" value={draft.language} /></> : null}
        {step === 4 ? <><Text style={styles.question}>Shape and review</Text><Text style={styles.prompt}>Choose depth, add optional source notes, and review your brief.</Text><View style={styles.choiceRow}>{(["short", "standard", "deep"] as const).map((length) => <Button key={length} accessibilityState={{ selected: draft.length === length }} onPress={() => setDraft((current) => ({ ...current, length }))} size="sm" style={styles.choice} variant={draft.length === length ? "secondary" : "ghost"}>{length}</Button>)}</View><TextInput accessibilityLabel="Optional source notes" multiline onChangeText={(value) => update("sourceNotes", value)} placeholder="Paste facts, references, constraints, or notes to use..." style={styles.notesInput} value={draft.sourceNotes} /><View style={styles.review}><Text style={styles.reviewLabel}>IDEA</Text><Text style={styles.reviewValue}>{draft.topic}</Text><Text style={styles.reviewLabel}>OUTCOME</Text><Text style={styles.reviewValue}>{draft.goal}</Text><Text style={styles.reviewLabel}>READER</Text><Text style={styles.reviewValue}>{draft.audience}</Text><Text style={styles.reviewLabel}>VOICE</Text><Text style={styles.reviewValue}>{draft.tone} · {draft.language}</Text></View></> : null}
       </ScrollView><View style={styles.wizardFooter}>{step > 0 ? <Button disabled={busy} icon={<ChevronLeftIcon size="sm" />} onPress={() => setStep((current) => current - 1)} size="md" variant="secondary">Back</Button> : <Button disabled={busy} onPress={() => { setDraft(INITIAL_DRAFT); generationRequestKey.current = undefined; setSheetOpen(false); }} size="md" variant="ghost">Discard</Button>}<Button disabled={busy || !valid()} loading={busy} onPress={() => step === STEPS.length - 1 ? void submit() : setStep((current) => current + 1)} size="md" style={styles.nextButton} variant="primary">{step === STEPS.length - 1 ? "Create book" : "Next"}</Button></View>{busy ? <Text accessibilityLiveRegion="polite" style={styles.generating}>Planning, writing, and narrating your book. Keep this screen open until it finishes.</Text> : null}</View> : null}
      {sheet === "reader" && detail ? <View style={{ maxHeight: height * 0.62 }}><Reader detail={detail} initialChapter={detail.book.currentChapterKey} onChange={(next) => { setDetail(next); setBooks((current) => current.map((book) => book.key === next.book.key ? next.book : book)); }} onMessage={setMessage} /></View> : null}
    </BottomSheet>
  </View>;
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: palette.voidBlack }, header: { paddingHorizontal: spacing.md, paddingBottom: 8 }, scroll: { paddingHorizontal: spacing.md }, heading: { marginTop: 26, marginBottom: 28, flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 18 }, eyebrow: { marginBottom: 10, color: palette.silver500, fontFamily: fonts.medium, fontSize: 10, letterSpacing: tracking.micro }, title: { color: palette.silver50, fontFamily: fonts.light, fontSize: 29, letterSpacing: -0.8 }, subtitle: { maxWidth: 480, marginTop: 8, color: palette.silver500, fontFamily: fonts.regular, fontSize: 13, lineHeight: 19 }, grid: { flexDirection: "row", flexWrap: "wrap" }, bookCard: { alignItems: "stretch", paddingHorizontal: 0, paddingVertical: 0 }, cover: { width: "100%", overflow: "hidden", borderWidth: 1, borderColor: palette.hairlineBright, borderRadius: radii.md, backgroundColor: palette.panelRaised }, generatedCover: { padding: 16, justifyContent: "space-between", shadowColor: palette.chromeWhite, shadowOpacity: 0.09, shadowRadius: 16 }, coverTitle: { color: palette.silver50, fontFamily: fonts.semibold, fontSize: 17, lineHeight: 20 }, coverSubtitle: { marginTop: 7, color: palette.silver300, fontFamily: fonts.regular, fontSize: 9, lineHeight: 13, letterSpacing: 0.7 }, bookTitle: { minHeight: 34, marginTop: 9, color: palette.silver100, fontFamily: fonts.medium, fontSize: 12, lineHeight: 16 }, bookMeta: { marginTop: 3, color: palette.silver500, fontFamily: fonts.regular, fontSize: 9, textTransform: "uppercase" }, message: { marginBottom: 20, padding: 13, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10, borderWidth: 1, borderColor: palette.hairline, borderRadius: radii.md, backgroundColor: palette.panel }, messageText: { flex: 1, color: palette.silver300, fontFamily: fonts.regular, fontSize: 12, lineHeight: 17 }, state: { minHeight: 340, alignItems: "center", justifyContent: "center", gap: 12 }, stateTitle: { color: palette.silver100, fontFamily: fonts.medium, fontSize: 17 }, stateCopy: { maxWidth: 360, color: palette.silver500, fontFamily: fonts.regular, fontSize: 13, lineHeight: 19, textAlign: "center" }, wizard: { flex: 1, gap: 14 }, progressRow: { flexDirection: "row", gap: 6 }, progressSegment: { height: 3, flex: 1, borderRadius: 2, backgroundColor: palette.gunmetal }, progressSegmentActive: { backgroundColor: palette.silver100 }, form: { gap: 14, paddingVertical: 18 }, question: { color: palette.silver50, fontFamily: fonts.light, fontSize: 25, lineHeight: 31 }, prompt: { maxWidth: 520, color: palette.silver500, fontFamily: fonts.regular, fontSize: 14, lineHeight: 21 }, largeInput: { minHeight: 150, textAlignVertical: "top" }, notesInput: { minHeight: 110, textAlignVertical: "top" }, choiceRow: { flexDirection: "row", gap: 8 }, choice: { flex: 1, paddingHorizontal: 8 }, review: { gap: 7, padding: 16, borderWidth: 1, borderColor: palette.hairline, borderRadius: radii.md, backgroundColor: palette.panel }, reviewLabel: { marginTop: 5, color: palette.silver500, fontFamily: fonts.medium, fontSize: 9, letterSpacing: tracking.micro }, reviewValue: { color: palette.silver100, fontFamily: fonts.regular, fontSize: 13, lineHeight: 18 }, wizardFooter: { flexDirection: "row", gap: 10, paddingTop: 10 }, nextButton: { flex: 1 }, generating: { color: palette.silver500, fontFamily: fonts.regular, fontSize: 11, textAlign: "center" }, reader: { gap: 24, paddingBottom: 24 }, readerHero: { flexDirection: "row", gap: 20 }, readerCover: { width: 148, flexShrink: 0 }, readerHeroCopy: { minWidth: 0, flex: 1, justifyContent: "center" }, readerTitle: { color: palette.silver50, fontFamily: fonts.light, fontSize: 27, lineHeight: 32 }, readerSubtitle: { marginTop: 5, color: palette.silver300, fontFamily: fonts.regular, fontSize: 14 }, readerDescription: { marginTop: 14, color: palette.silver500, fontFamily: fonts.regular, fontSize: 13, lineHeight: 19 }, readerMeta: { marginTop: 16, color: palette.silver500, fontFamily: fonts.medium, fontSize: 9, letterSpacing: 1.1 }, readerColumns: { gap: 22 }, chapterList: { gap: 5 }, microLabel: { marginBottom: 5, color: palette.silver500, fontFamily: fonts.medium, fontSize: 9, letterSpacing: tracking.micro }, chapterButton: { minHeight: 66, justifyContent: "flex-start", gap: 11, paddingHorizontal: 10, borderRadius: radii.md }, chapterButtonActive: { backgroundColor: palette.panelRaised }, chapterPosition: { width: 28, height: 28, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: palette.hairline, borderRadius: 14 }, chapterNumber: { color: palette.silver500, fontFamily: fonts.medium, fontSize: 10 }, chapterCopy: { minWidth: 0, flex: 1, alignItems: "flex-start" }, chapterTitle: { color: palette.silver100, fontFamily: fonts.medium, fontSize: 13 }, chapterDescription: { marginTop: 3, color: palette.silver500, fontFamily: fonts.regular, fontSize: 11, lineHeight: 15 }, chapterContent: { gap: 10, paddingTop: 8 }, contentTitle: { color: palette.silver50, fontFamily: fonts.light, fontSize: 27, lineHeight: 33 }, contentDescription: { color: palette.silver500, fontFamily: fonts.regular, fontSize: 14, lineHeight: 21 }, chapterBody: { marginTop: 8, color: palette.silver300, fontFamily: fonts.regular, fontSize: 16, lineHeight: 27 }, audioCard: { marginVertical: 8, padding: 12, flexDirection: "row", alignItems: "center", gap: 12, borderWidth: 1, borderColor: palette.hairlineBright, borderRadius: radii.lg, backgroundColor: palette.panelRaised }, audioMain: { flex: 1, gap: 5 }, audioHeading: { flexDirection: "row", alignItems: "center", gap: 6 }, audioLabel: { color: palette.silver300, fontFamily: fonts.medium, fontSize: 9, letterSpacing: 1.5 }, audioTrack: { height: 3, overflow: "hidden", borderRadius: 2, backgroundColor: palette.gunmetal }, audioFill: { height: "100%", backgroundColor: palette.silver100 }, audioTime: { color: palette.silver500, fontFamily: fonts.regular, fontSize: 9 },
});
