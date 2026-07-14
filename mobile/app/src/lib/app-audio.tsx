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

import {
  AMBIENT_AUDIO_SOURCE,
  CAPABILITY_BRIEFING_SOURCES,
} from "@/data/audio";
import type { CapabilitySlug } from "@/data/registry";

const AMBIENT_VOLUME = 0.066;
const AMBIENT_DUCKED_VOLUME = 0.024;
const BRIEFING_VOLUME = 0.9;

type AppAudioContextValue = {
  playingBriefing: CapabilitySlug | null;
  stopBriefing: () => void;
  toggleBriefing: (slug: CapabilitySlug) => void;
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

    setAudioModeAsync({
      playsInSilentMode: true,
      shouldPlayInBackground: true,
      interruptionMode: "doNotMix",
    })
      .then(() => {
        if (!active) return;
        ambientPlayer.loop = true;
        ambientPlayer.volume = AMBIENT_VOLUME;
        ambientPlayer.setActiveForLockScreen(
          true,
          {
            title: "Vorinthex AI",
            artist: "The Nexus of Intelligence",
            albumTitle: "Core",
          },
          { showSeekBackward: false, showSeekForward: false },
        );
        ambientPlayer.play();
      })
      .catch(() => {});

    return () => {
      active = false;
      ambientPlayer.setActiveForLockScreen(false);
    };
  }, [ambientPlayer]);

  const stopBriefing = useCallback(() => {
    briefingPlayer.pause();
    briefingPlayer.seekTo(0).catch(() => {});
    ambientPlayer.volume = AMBIENT_VOLUME;
    setPlayingBriefing(null);
  }, [ambientPlayer, briefingPlayer]);

  const toggleBriefing = useCallback(
    (slug: CapabilitySlug) => {
      if (playingBriefing === slug) {
        stopBriefing();
        return;
      }

      briefingPlayer.pause();
      briefingPlayer.replace(CAPABILITY_BRIEFING_SOURCES[slug]);
      briefingPlayer.volume = BRIEFING_VOLUME;
      ambientPlayer.volume = AMBIENT_DUCKED_VOLUME;
      setPlayingBriefing(slug);
      briefingPlayer.play();
    },
    [ambientPlayer, briefingPlayer, playingBriefing, stopBriefing],
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
    () => ({ playingBriefing, stopBriefing, toggleBriefing }),
    [playingBriefing, stopBriefing, toggleBriefing],
  );

  return <AppAudioContext.Provider value={value}>{children}</AppAudioContext.Provider>;
}

export function useAppAudio(): AppAudioContextValue {
  const value = useContext(AppAudioContext);
  if (!value) throw new Error("useAppAudio must be used inside AppAudioProvider");
  return value;
}
