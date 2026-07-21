"use client";

import { create } from "zustand";
import { trackLandingEvent } from "@/lib/analytics";

/**
 * The galaxy's sound has three channels:
 * AMBIENT is the master-brand bed — very subtle, starts on the first user
 *   gesture (scroll/tap/click) and loops forever underneath everything.
 * MISSION is the hunt briefing voice started by the Briefing CTA inside
 *   the hunt biome. It plays exactly once per tap (no loop); tapping
 *   again mid-play cancels it. While it speaks, any biome voice is
 *   paused and resumes where it left off.
 * VOICE is the current world's voiceover.
 */

export const MISSION_AUDIO_SRC = "/audio/brand/hunt-briefing.mp3";
export const AMBIENT_AUDIO_SRC = "/audio/brand/master-brand-vorinthex-ai-v1.mp3";

export function entityAudioUrl(type: string, slug: string): string {
  return `/audio/entities/${type}-${slug}.mp3`;
}

/** The orchestrator's personal message — played by "Meet <name>" in its biome. */
export function orchestratorMessageUrl(slug: string): string {
  return `/audio/entities/orchestrator-${slug}-message.mp3`;
}

const AMBIENT_VOLUME = 0.066;
const AMBIENT_DUCKED = 0.024;
const MISSION_VOLUME = 0.55;
const VOICE_VOLUME = 0.9;

let ambient: HTMLAudioElement | null = null;
let mission: HTMLAudioElement | null = null;
let voice: HTMLAudioElement | null = null;

/** The biome voice line the mission interrupted; resumed when it ends. */
let voiceHeldForMission = false;
/** A voice requested while the mission speaks; starts once it finishes. */
let voiceQueuedBehindMission: string | null = null;

function anyForegroundAudioPlaying() {
  return Boolean((mission && !mission.paused) || (voice && !voice.paused));
}

function settleAmbientVolume() {
  if (!ambient) return;
  ambient.volume = anyForegroundAudioPlaying() ? AMBIENT_DUCKED : AMBIENT_VOLUME;
}

function ambientElement(): HTMLAudioElement {
  if (!ambient) {
    ambient = new Audio(AMBIENT_AUDIO_SRC);
    ambient.autoplay = true;
    ambient.loop = true;
    ambient.preload = "auto";
    ambient.volume = AMBIENT_VOLUME;
  }
  return ambient;
}

function missionElement(): HTMLAudioElement {
  if (!mission) {
    mission = new Audio(MISSION_AUDIO_SRC);
    mission.loop = false;
    mission.preload = "auto";
    mission.volume = MISSION_VOLUME;
  }
  return mission;
}

function voiceElement(): HTMLAudioElement {
  if (!voice) {
    voice = new Audio();
    voice.preload = "auto";
    voice.volume = VOICE_VOLUME;
    voice.addEventListener("play", settleAmbientVolume);
    voice.addEventListener("ended", settleAmbientVolume);
    voice.addEventListener("pause", settleAmbientVolume);
  }
  return voice;
}

interface AudioState {
  missionPlaying: boolean;
  ambientStarted: boolean;
  pendingVoiceSrc: string | null;
  /** Tap once → hear once; tap mid-voice → cancel. */
  toggleMission: () => void;
  startAmbient: () => void;
  playVoice: (src: string) => void;
  stopVoice: () => void;
  stopForegroundAudio: () => void;
  pauseVoice: () => void;
  resumeVoice: () => void;
  resumePending: () => void;
}

export const useAudioStore = create<AudioState>((set, get) => {
  /** Start the mission voice from the top; pauses/queues the biome voice. */
  const startMission = (onBlocked?: () => void) => {
    const audio = missionElement();

    // A biome voice mid-line steps aside and continues afterwards — and a
    // voice that autoplay held back gets its turn after the mission.
    if (voice && !voice.paused) {
      voiceHeldForMission = true;
      voice.pause();
    }
    const pendingSrc = get().pendingVoiceSrc;
    if (pendingSrc) {
      voiceQueuedBehindMission = pendingSrc;
      set({ pendingVoiceSrc: null });
    }

    const finish = () => {
      audio.removeEventListener("ended", finish);
      set({ missionPlaying: false });
      if (voiceHeldForMission) {
        voiceHeldForMission = false;
        get().resumeVoice();
      } else if (voiceQueuedBehindMission) {
        const queued = voiceQueuedBehindMission;
        voiceQueuedBehindMission = null;
        get().playVoice(queued);
      }
      settleAmbientVolume();
    };
    audio.addEventListener("ended", finish);

    audio.currentTime = 0;
    audio
      .play()
      .then(() => {
        set({ missionPlaying: true });
        settleAmbientVolume();
        trackLandingEvent({
          slug: "landing.mission_voice_played",
          metadata: { src: MISSION_AUDIO_SRC },
        });
      })
      .catch(() => {
        audio.removeEventListener("ended", finish);
        if (voiceHeldForMission) {
          voiceHeldForMission = false;
          get().resumeVoice();
        }
        onBlocked?.();
      });
  };

  return {
  missionPlaying: false,
  ambientStarted: false,
  pendingVoiceSrc: null,

  toggleMission: () => {
    const audio = missionElement();

    if (!audio.paused) {
      // Tap mid-voice: cancel outright and hand the floor back.
      audio.pause();
      audio.currentTime = 0;
      set({ missionPlaying: false });
      trackLandingEvent({
        slug: "landing.mission_voice_cancelled",
        metadata: { src: MISSION_AUDIO_SRC },
      });
      if (voiceHeldForMission) {
        voiceHeldForMission = false;
        get().resumeVoice();
      } else if (voiceQueuedBehindMission) {
        const queued = voiceQueuedBehindMission;
        voiceQueuedBehindMission = null;
        get().playVoice(queued);
      }
      settleAmbientVolume();
      return;
    }

    startMission();
  },

  startAmbient: () => {
    if (get().ambientStarted) return;
    const audio = ambientElement();
    audio
      .play()
      .then(() => {
        set({ ambientStarted: true });
        settleAmbientVolume();
        trackLandingEvent({
          slug: "landing.ambient_audio_started",
          metadata: { src: AMBIENT_AUDIO_SRC },
        });
      })
      .catch(() => {});
  },

  playVoice: (src) => {
    // The mission voice has the floor; the biome line waits its turn.
    if (mission && !mission.paused) {
      voiceQueuedBehindMission = src;
      return;
    }
    const normalizedSrc = new URL(src, window.location.href).href;
    if (voice && !voice.paused && voice.src === normalizedSrc) {
      voice.pause();
      voice.currentTime = 0;
      set({ pendingVoiceSrc: null });
      settleAmbientVolume();
      return;
    }
    const audio = voiceElement();
    audio.src = src;
    audio.currentTime = 0;
    audio
      .play()
      .then(() => {
        set({ pendingVoiceSrc: null });
        trackLandingEvent({
          slug: "landing.audio_played",
          metadata: { audio_kind: "voice", src },
        });
      })
      .catch(() => set({ pendingVoiceSrc: src }));
  },

  stopVoice: () => {
    if (voice && !voice.paused) voice.pause();
    voiceHeldForMission = false;
    voiceQueuedBehindMission = null;
    set({ pendingVoiceSrc: null });
  },

  stopForegroundAudio: () => {
    if (mission && !mission.paused) mission.pause();
    if (mission) mission.currentTime = 0;
    if (voice && !voice.paused) voice.pause();
    voiceHeldForMission = false;
    voiceQueuedBehindMission = null;
    set({ missionPlaying: false, pendingVoiceSrc: null });
    settleAmbientVolume();
  },

  pauseVoice: () => {
    if (voice && !voice.paused) voice.pause();
  },

  resumeVoice: () => {
    if (voice && voice.paused && voice.src && voice.currentTime > 0 && !voice.ended) {
      voice.play().catch(() => {});
    }
  },

  resumePending: () => {
    // The first gesture that unlocks audio releases any voice line the
    // browser held back (the ambient bed starts alongside it).
    const pending = get().pendingVoiceSrc;
    if (pending) get().playVoice(pending);
  },
  };
});
