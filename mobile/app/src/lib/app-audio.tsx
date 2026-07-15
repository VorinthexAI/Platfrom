import {
  setAudioModeAsync,
  useAudioPlayer,
  useAudioPlayerStatus,
} from "expo-audio";
import {
  createContext,
  type PropsWithChildren,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { AppState } from "react-native";

import {
  AMBIENT_AUDIO_SOURCE,
  CAPABILITY_BRIEFING_SOURCES,
} from "@/data/audio";
import type { CapabilitySlug } from "@/data/registry";

const AMBIENT_VOLUME = 0.066;
// Ducked, never silenced: the soundtrack keeps playing UNDER a briefing —
// the two always sound together.
const AMBIENT_DUCKED_VOLUME = 0.04;
const BRIEFING_VOLUME = 0.9;

type AppAudioContextValue = {
  playingBriefing: CapabilitySlug | null;
  stopBriefing: () => void;
  toggleBriefing: (slug: CapabilitySlug) => void;
  /** Idempotent start — used by the biome auto-briefing on arrival. */
  playBriefing: (slug: CapabilitySlug) => void;
};

const AppAudioContext = createContext<AppAudioContextValue | null>(null);

/** Persistent soundtrack and voice conductor shared by every mobile route. */
export function AppAudioProvider({ children }: PropsWithChildren) {
  const ambientPlayer = useAudioPlayer(AMBIENT_AUDIO_SOURCE, {
    downloadFirst: true,
    updateInterval: 1000,
  });
  const briefingPlayer = useAudioPlayer(null, {
    downloadFirst: true,
    updateInterval: 250,
  });
  const briefingStatus = useAudioPlayerStatus(briefingPlayer);
  const [playingBriefing, setPlayingBriefing] = useState<CapabilitySlug | null>(null);

  useEffect(() => {
    let active = true;

    // The soundtrack lives and dies WITH the app: no background playback,
    // no lock-screen session, no Android playback service. The service
    // (and its teardown while the OS kills the app) was the prime suspect
    // for the crash-on-close, and in Expo Go it could never bind anyway.
    setAudioModeAsync({
      playsInSilentMode: true,
      shouldPlayInBackground: false,
      interruptionMode: "doNotMix",
    })
      .then(() => {
        if (!active) return;
        ambientPlayer.loop = true;
        ambientPlayer.volume = AMBIENT_VOLUME;
        ambientPlayer.play();
      })
      .catch(() => {});

    return () => {
      active = false;
    };
  }, [ambientPlayer]);

  const stopBriefing = useCallback(() => {
    briefingPlayer.pause();
    briefingPlayer.seekTo(0).catch(() => {});
    ambientPlayer.volume = AMBIENT_VOLUME;
    ambientPlayer.play();
    setPlayingBriefing(null);
  }, [ambientPlayer, briefingPlayer]);

  // Leaving the foreground — backgrounded, task-switched, screen off —
  // silences EVERYTHING immediately: the briefing is stopped outright
  // (not resumed mid-sentence later) and the soundtrack pauses. Coming
  // back restarts only the soundtrack; play() is a no-op while playing.
  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => {
      try {
        if (state === "active") {
          ambientPlayer.play();
        } else {
          stopBriefing();
          ambientPlayer.pause();
        }
      } catch {}
    });
    return () => subscription.remove();
  }, [ambientPlayer, stopBriefing]);

  const startBriefing = useCallback(
    (slug: CapabilitySlug) => {
      briefingPlayer.pause();
      briefingPlayer.replace(CAPABILITY_BRIEFING_SOURCES[slug]);
      briefingPlayer.volume = BRIEFING_VOLUME;
      // Duck, don't stop — music and briefing play together.
      ambientPlayer.volume = AMBIENT_DUCKED_VOLUME;
      ambientPlayer.play();
      setPlayingBriefing(slug);
      briefingPlayer.play();
    },
    [ambientPlayer, briefingPlayer],
  );

  const toggleBriefing = useCallback(
    (slug: CapabilitySlug) => {
      if (playingBriefing === slug) {
        stopBriefing();
        return;
      }
      startBriefing(slug);
    },
    [playingBriefing, startBriefing, stopBriefing],
  );

  const playBriefing = useCallback(
    (slug: CapabilitySlug) => {
      if (playingBriefing === slug) return;
      startBriefing(slug);
    },
    [playingBriefing, startBriefing],
  );

  useEffect(() => {
    if (playingBriefing && (briefingStatus.didJustFinish || briefingStatus.error)) {
      ambientPlayer.volume = AMBIENT_VOLUME;
      setPlayingBriefing(null);
    }
  }, [
    ambientPlayer,
    briefingStatus.didJustFinish,
    briefingStatus.error,
    playingBriefing,
  ]);

  const value = useMemo(
    () => ({ playingBriefing, stopBriefing, toggleBriefing, playBriefing }),
    [playingBriefing, stopBriefing, toggleBriefing, playBriefing],
  );

  return <AppAudioContext.Provider value={value}>{children}</AppAudioContext.Provider>;
}

export function useAppAudio(): AppAudioContextValue {
  const value = useContext(AppAudioContext);
  if (!value) throw new Error("useAppAudio must be used inside AppAudioProvider");
  return value;
}
