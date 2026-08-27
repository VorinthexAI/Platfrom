import { useQuery, useQueryClient } from "@tanstack/react-query";
import { setAudioModeAsync, useAudioPlayer, useAudioPlayerStatus } from "expo-audio";
import { createContext, useContext, useEffect, useEffectEvent, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AppState } from "react-native";

import { adjacentBookChapter, BOOK_AUDIO_MODE, bookAudioMetadata, clampBookSeek } from "./book-audio";
import { pauseOwnedPlayer } from "./audio-player-lifecycle";
import { getBookPlaybackIdentity, getBookProgressKey, shouldRefreshSignedMedia } from "./book-playback-policy";
import { beginReplacement, clampBookPlaybackSeek, observeReplacementLoad, type ReplacementLoadState } from "./book-playback-replacement";
import { BookProgressWriter, type BookProgressIntent } from "./book-progress";
import { fetchBookDetail, getBooksContext, updateBookChapterProgress, type BookChapter, type BookDetail } from "./books-client";
import { ascendQueryKeys, mergeBookDetailProgress, patchCachedBookDetail, patchCachedBookProgress } from "./workspace-query-cache";
import { useAuthStore } from "@/state/auth";

type ProgressJob = { bookKey: string; chapterKey: string; context: { organizationKey: string; scopeKey: string }; identity: string; intent: BookProgressIntent };

type BookPlaybackValue = {
  audio: ReturnType<typeof useAudioPlayerStatus>;
  chapter?: BookChapter;
  chapterIndex: number;
  clear: (persist?: boolean) => void;
  currentTime: number;
  detail?: BookDetail;
  duration: number;
  error?: string;
  moveChapter: (offset: number) => Promise<void>;
  orderedChapters: BookChapter[];
  persistenceError?: string;
  playBookChapter: (bookKey: string, chapterKey: string, autoplay?: boolean, seek?: number) => Promise<void>;
  playbackBookKey?: string;
  playbackChapterKey?: string;
  readerRequest: number;
  refreshWarning?: string;
  refreshingUrl: boolean;
  refreshUrl: () => Promise<void>;
  requestReader: () => void;
  seek: (seconds: number) => void;
  setSleepMinutes: (minutes: number) => void;
  setSpeed: (speed: number) => void;
  sleepMinutes: number;
  speed: number;
  toggle: () => Promise<void>;
};

const BookPlaybackContext = createContext<BookPlaybackValue | null>(null);

function message(error: unknown) {
  return error instanceof Error ? error.message : "Audiobook playback could not complete that request.";
}

export function BookPlaybackProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const userKey = useAuthStore((state) => typeof state.user?.key === "string" ? state.user.key : undefined);
  const organizationKey = useAuthStore((state) => typeof state.organization?.key === "string" ? state.organization.key : "");
  const scopeKey = useAuthStore((state) => typeof state.scope?.key === "string" ? state.scope.key : "");
  const identity = getBookPlaybackIdentity(userKey, organizationKey, scopeKey);
  const context = useMemo(() => ({ organizationKey, scopeKey }), [organizationKey, scopeKey]);
  const [playbackBookKey, setPlaybackBookKey] = useState<string>();
  const [playbackChapterKey, setPlaybackChapterKey] = useState<string>();
  const [speed, setSpeedState] = useState(1);
  const [sleepDeadline, setSleepDeadline] = useState<number>();
  const [sleepMinutes, setSleepMinutesState] = useState(0);
  const [refreshingUrl, setRefreshingUrl] = useState(false);
  const [playbackError, setPlaybackError] = useState<string>();
  const [persistenceError, setPersistenceError] = useState<string>();
  const [refreshWarning, setRefreshWarning] = useState<string>();
  const [readerRequest, setReaderRequest] = useState(0);
  const [progressWriter] = useState(() => new BookProgressWriter());
  const player = useAudioPlayer(null, { updateInterval: 500, keepAudioSessionActive: true });
  const audio = useAudioPlayerStatus(player);
  const audioPlayerActive = useRef(true);
  const loadedSource = useRef<{ bookKey: string; chapterKey: string; loadedAt: number; url: string } | undefined>(undefined);
  const refreshAttempts = useRef(new Map<string, number>());
  const failedRefreshes = useRef(new Set<string>());
  const pendingSeek = useRef(0);
  const playWhenLoaded = useRef(false);
  const replacementId = useRef(0);
  const playbackRequest = useRef(0);
  const lastSaved = useRef(new Map<string, number>());
  const progressJobs = useRef(new Map<string, ProgressJob>());
  const finishedChapter = useRef<string | undefined>(undefined);
  const previousPlaying = useRef(false);
  const previousIdentity = useRef(identity);
  const identityRef = useRef(identity);
  const replacement = useRef<ReplacementLoadState | undefined>(undefined);
  useLayoutEffect(() => { identityRef.current = identity; }, [identity]);

  const detailQuery = useQuery({
    enabled: Boolean(playbackBookKey && identity),
    queryKey: ascendQueryKeys.detail(context, playbackBookKey ?? "none"),
    queryFn: async () => {
      const incoming = await fetchBookDetail(playbackBookKey!);
      return mergeBookDetailProgress(queryClient.getQueryData<BookDetail>(ascendQueryKeys.detail(context, playbackBookKey!)), incoming);
    },
  });
  const detail = detailQuery.data;
  const orderedChapters = useMemo(() => [...(detail?.chapters ?? [])].filter((chapter) => chapter.content && chapter.audioUrl).sort((left, right) => left.position - right.position), [detail?.chapters]);
  const chapterIndex = orderedChapters.findIndex(({ key }) => key === playbackChapterKey);
  const chapter = chapterIndex >= 0 ? orderedChapters[chapterIndex] : undefined;
  const duration = audio.isLoaded && audio.duration > 0 ? audio.duration : chapter?.audioDurationSeconds ?? 0;
  const currentTime = audio.isLoaded ? audio.currentTime : chapter?.progressSeconds ?? 0;
  const initialQueryError = !detail && detailQuery.error ? message(detailQuery.error) : undefined;
  const error = playbackError
    ?? initialQueryError
    ?? (detail && playbackChapterKey && !chapter ? "The selected chapter is no longer available." : undefined)
    ?? (chapter && !chapter.audioUrl ? "Audio is not available for this chapter." : undefined);

  const writeProgress = async (job: ProgressJob) => {
    if (job.identity !== identityRef.current) return;
    const key = getBookProgressKey(job.identity, job.bookKey, job.chapterKey);
    progressJobs.current.set(key, job);
    try {
      await progressWriter.enqueue(key, job.intent, async (intent) => {
        const result = await updateBookChapterProgress(job.bookKey, job.chapterKey, intent);
        if (job.identity !== identityRef.current) return;
        patchCachedBookProgress(queryClient, job.context, result.book, result.chapter);
      });
      if (job.identity !== identityRef.current) return;
      progressJobs.current.delete(key);
      setPersistenceError(undefined);
    } catch (writeError) {
      if (job.identity === identityRef.current) {
        setPersistenceError(`Reading progress will retry when the connection returns. ${message(writeError)}`);
      }
      throw writeError;
    }
  };

  const saveCurrentProgress = async (completed = false) => {
    if (!detail || !chapter || !identity) return;
    const key = getBookProgressKey(identity, detail.book.key, chapter.key);
    const seconds = Math.max(0, Math.floor(completed ? Math.max(duration, currentTime) : currentTime));
    if (!completed && seconds === lastSaved.current.get(key)) return;
    lastSaved.current.set(key, Math.max(lastSaved.current.get(key) ?? 0, seconds));
    await writeProgress({ bookKey: detail.book.key, chapterKey: chapter.key, context: getBooksContext(), identity, intent: { progressSeconds: Math.max(seconds, chapter.progressSeconds), isCompleted: completed || chapter.isCompleted } });
  };

  const retryProgress = useEffectEvent(() => {
    for (const job of progressJobs.current.values()) void writeProgress(job).catch(() => undefined);
  });
  const persistForLifecycle = useEffectEvent(() => {
    void saveCurrentProgress().catch(() => undefined);
    retryProgress();
  });
  const tick = useEffectEvent(() => {
    if (audio.playing && detail && chapter) {
      if (!identity) return;
      const key = getBookProgressKey(identity, detail.book.key, chapter.key);
      if (currentTime - (lastSaved.current.get(key) ?? chapter.progressSeconds) >= 15) void saveCurrentProgress().catch(() => undefined);
    }
    const source = loadedSource.current;
    if (audio.playing && source && !refreshingUrl) {
      const sourceKey = `${source.bookKey}:${source.chapterKey}`;
      if (!failedRefreshes.current.has(sourceKey) && shouldRefreshSignedMedia({
        force: false,
        playbackFailed: false,
        loadedAt: source.loadedAt,
        lastAttemptAt: refreshAttempts.current.get(sourceKey),
        now: Date.now(),
      })) {
        void playBookChapter(source.bookKey, source.chapterKey, true, currentTime);
      }
    }
    retryProgress();
  });

  async function fetchMergedDetail(bookKey: string) {
    const key = ascendQueryKeys.detail(context, bookKey);
    const incoming = await queryClient.fetchQuery({
      queryKey: key,
      queryFn: async () => {
        const fetched = await fetchBookDetail(bookKey);
        return mergeBookDetailProgress(queryClient.getQueryData<BookDetail>(key), fetched);
      },
      staleTime: 0,
    });
    patchCachedBookDetail(queryClient, context, incoming);
    return mergeBookDetailProgress(queryClient.getQueryData<BookDetail>(key), incoming);
  }

  async function playBookChapter(bookKey: string, chapterKey: string, autoplay = true, seek?: number, saveOutgoing = true, forceRefresh = false) {
    const request = ++playbackRequest.current;
    if (replacement.current) {
      replacement.current = undefined;
      replacementId.current += 1;
      pendingSeek.current = 0;
      playWhenLoaded.current = false;
      loadedSource.current = undefined;
      pauseOwnedPlayer(player, audioPlayerActive.current);
      player.replace(null);
    }
    const sourceKey = `${bookKey}:${chapterKey}`;
    const sameLoadedSource = loadedSource.current?.bookKey === bookKey && loadedSource.current.chapterKey === chapterKey;
    const loadedAt = sameLoadedSource ? loadedSource.current!.loadedAt : 0;
    const shouldRefresh = sameLoadedSource && audio.isLoaded
      ? shouldRefreshSignedMedia({
        force: forceRefresh,
        playbackFailed: Boolean(audio.error),
        loadedAt,
        lastAttemptAt: refreshAttempts.current.get(sourceKey),
        now: Date.now(),
      })
      : true;
    if (sameLoadedSource && audio.isLoaded && !audio.error && !shouldRefresh) {
      if (seek !== undefined) await player.seekTo(clampBookSeek(seek, duration));
      if (autoplay) player.play();
      return;
    }
    if (sameLoadedSource && audio.error && !shouldRefresh) return;
    setPlaybackError(undefined);
    setRefreshWarning(undefined);
    setRefreshingUrl(true);
    refreshAttempts.current.set(sourceKey, Date.now());
    const hadValidSource = Boolean(loadedSource.current && audio.isLoaded && !audio.error);
    try {
      const refreshed = await fetchMergedDetail(bookKey);
      if (request !== playbackRequest.current) return;
      const next = refreshed.chapters.find(({ key }) => key === chapterKey);
      if (!next) throw new Error("The selected chapter is no longer available.");
      if (!next.audioUrl) throw new Error("Chapter audio is unavailable.");
      if (saveOutgoing) {
        pauseOwnedPlayer(player, audioPlayerActive.current);
        await saveCurrentProgress().catch(() => undefined);
        if (request !== playbackRequest.current) return;
      }
      refreshAttempts.current.delete(sourceKey);
      failedRefreshes.current.delete(sourceKey);
      setPlaybackBookKey(bookKey);
      setPlaybackChapterKey(next.key);
      loadedSource.current = { bookKey, chapterKey: next.key, loadedAt: Date.now(), url: next.audioUrl };
      pendingSeek.current = seek ?? next.progressSeconds;
      playWhenLoaded.current = autoplay;
      const id = ++replacementId.current;
      replacement.current = beginReplacement(id, request, audio.isLoaded);
      player.replace(next.audioUrl);
    } catch (playError) {
      if (request === playbackRequest.current) {
        failedRefreshes.current.add(sourceKey);
        if (hadValidSource) {
          setRefreshWarning(`${message(playError)} The current audio remains available.`);
          if (sameLoadedSource && autoplay) player.play();
        } else setPlaybackError(message(playError));
      }
    } finally {
      if (request === playbackRequest.current) setRefreshingUrl(false);
    }
  }

  async function toggle() {
    if (!chapter?.audioUrl || !playbackBookKey) return;
    if (audio.playing) {
      pauseOwnedPlayer(player, audioPlayerActive.current);
      await saveCurrentProgress().catch(() => undefined);
      return;
    }
    await playBookChapter(playbackBookKey, chapter.key, true, audio.didJustFinish ? 0 : currentTime);
  }

  async function moveChapter(offset: number) {
    const next = adjacentBookChapter(orderedChapters, chapter?.key, offset < 0 ? -1 : 1);
    if (!next || !playbackBookKey) return;
    await playBookChapter(playbackBookKey, next.key, audio.playing);
  }

  async function refreshUrl() {
    if (playbackBookKey && playbackChapterKey) await playBookChapter(playbackBookKey, playbackChapterKey, audio.playing, currentTime, true, true);
  }

  function clear(persist = true) {
    playbackRequest.current += 1;
    if (persist) void saveCurrentProgress().catch(() => undefined);
    else {
      progressWriter.reset();
      progressJobs.current.clear();
      lastSaved.current.clear();
    }
    pauseOwnedPlayer(player, audioPlayerActive.current);
    player.replace(null);
    player.clearLockScreenControls();
    loadedSource.current = undefined;
    refreshAttempts.current.clear();
    failedRefreshes.current.clear();
    replacement.current = undefined;
    replacementId.current += 1;
    pendingSeek.current = 0;
    playWhenLoaded.current = false;
    finishedChapter.current = undefined;
    previousPlaying.current = false;
    setPlaybackBookKey(undefined);
    setPlaybackChapterKey(undefined);
    setPlaybackError(undefined);
    setPersistenceError(undefined);
    setRefreshWarning(undefined);
    setRefreshingUrl(false);
    setSleepDeadline(undefined);
    setSleepMinutesState(0);
  }

  useEffect(() => { void setAudioModeAsync(BOOK_AUDIO_MODE).catch((modeError) => setPlaybackError(message(modeError))); }, []);
  const handleReplacementStatus = useEffectEvent(() => {
    const pending = replacement.current;
    if (!pending) return;
    const observed = observeReplacementLoad(pending, playbackRequest.current, replacementId.current, audio.isLoaded);
    replacement.current = observed.state;
    if (!observed.ready) return;
    replacement.current = undefined;
    const shouldPlay = playWhenLoaded.current;
    playWhenLoaded.current = false;
    const seek = clampBookPlaybackSeek(pendingSeek.current, audio.duration);
    void player.seekTo(seek)
      .catch((seekError) => {
        if (pending.requestId === playbackRequest.current && pending.id === replacementId.current) {
          setPlaybackError(message(seekError));
        }
      })
      .finally(() => {
        if (shouldPlay && pending.requestId === playbackRequest.current && pending.id === replacementId.current) player.play();
      });
  });
  useEffect(() => {
    handleReplacementStatus();
  }, [audio.isLoaded, player]);
  const handlePlaybackFailure = useEffectEvent(() => {
    if (!audio.error || !playbackBookKey || !playbackChapterKey || refreshingUrl) return;
    void playBookChapter(playbackBookKey, playbackChapterKey, previousPlaying.current, currentTime);
  });
  useEffect(() => {
    handlePlaybackFailure();
  }, [audio.error]);
  useEffect(() => {
    if (!detail || !chapter?.audioUrl || error) { if (!detail || !chapter?.audioUrl) player.clearLockScreenControls(); return; }
    player.setActiveForLockScreen(true, bookAudioMetadata(detail.book, chapter), { showSeekBackward: true, showSeekForward: true });
  }, [chapter, detail, error, player]);
  useEffect(() => { player.setPlaybackRate(speed); }, [player, speed]);
  const handleFinished = useEffectEvent(() => {
    if (!audio.didJustFinish || !chapter || !detail || finishedChapter.current === chapter.key) return;
    finishedChapter.current = chapter.key;
    const next = adjacentBookChapter(orderedChapters, chapter.key, 1);
    void saveCurrentProgress(true).catch(() => undefined);
    if (next) void playBookChapter(detail.book.key, next.key, true, undefined, false);
  });
  useEffect(() => {
    queueMicrotask(handleFinished);
  }, [audio.didJustFinish]);
  useEffect(() => { if (!audio.didJustFinish) finishedChapter.current = undefined; }, [audio.didJustFinish]);
  const handlePlayingChange = useEffectEvent(() => {
    if (previousPlaying.current && !audio.playing) void saveCurrentProgress().catch(() => undefined);
    previousPlaying.current = audio.playing;
  });
  useEffect(() => {
    handlePlayingChange();
  }, [audio.playing]);
  useEffect(() => {
    const timer = setInterval(tick, 5_000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => {
      persistForLifecycle();
      if (state === "active") retryProgress();
    });
    return () => subscription.remove();
  }, []);
  const handleIdentityChange = useEffectEvent(() => {
    if (previousIdentity.current !== identity) clear(false);
    previousIdentity.current = identity;
  });
  useEffect(() => {
    handleIdentityChange();
  }, [identity]);
  const handleSleepExpiry = useEffectEvent(() => {
    pauseOwnedPlayer(player, audioPlayerActive.current);
    setSleepDeadline(undefined);
    setSleepMinutesState(0);
    void saveCurrentProgress().catch(() => undefined);
  });
  useEffect(() => {
    if (!sleepDeadline) return;
    const remaining = sleepDeadline - Date.now();
    const timer = setTimeout(handleSleepExpiry, Math.max(0, remaining));
    return () => clearTimeout(timer);
  }, [player, sleepDeadline]);
  useEffect(() => () => {
    audioPlayerActive.current = false;
    playbackRequest.current += 1;
    persistForLifecycle();
  }, []);

  const value: BookPlaybackValue = {
    audio,
    chapter,
    chapterIndex,
    clear,
    currentTime,
    detail,
    duration,
    error,
    moveChapter,
    orderedChapters,
    persistenceError,
    playBookChapter,
    playbackBookKey,
    playbackChapterKey,
    readerRequest,
    refreshWarning,
    refreshingUrl,
    refreshUrl,
    requestReader: () => setReaderRequest((current) => current + 1),
    seek: (seconds) => { void player.seekTo(clampBookSeek(seconds, duration)); },
    setSleepMinutes: (minutes) => {
      setSleepMinutesState(minutes);
      setSleepDeadline(minutes ? Date.now() + minutes * 60_000 : undefined);
    },
    setSpeed: setSpeedState,
    sleepMinutes,
    speed,
    toggle,
  };
  return <BookPlaybackContext.Provider value={value}>{children}</BookPlaybackContext.Provider>;
}

export function useBookPlayback() {
  const value = useContext(BookPlaybackContext);
  if (!value) throw new Error("Book playback must be used inside BookPlaybackProvider.");
  return value;
}
