"use client";

import { create } from "zustand";
import { trackLandingEvent } from "@/lib/analytics";
import { createPlaybackGeneration } from "./playback-generation";
import { voiceToggleAction } from "./voice-toggle";

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
let voiceRequestedSrc: string | null = null;
const missionPlayback = createPlaybackGeneration();
let missionRequested = false;
let removeMissionEnded: (() => void) | null = null;
const voicePlayback = createPlaybackGeneration();
let voiceGeneration = 0;
let removeVoiceListeners: (() => void) | null = null;

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

function createMissionElement(): HTMLAudioElement {
  const audio = new Audio(MISSION_AUDIO_SRC);
  audio.loop = false;
  audio.preload = "auto";
  audio.volume = MISSION_VOLUME;
  return audio;
}

function invalidateVoicePlayback(resetPosition: boolean) {
  voicePlayback.invalidate();
  removeVoiceListeners?.();
  removeVoiceListeners = null;
  if (voice) {
    voice.pause();
    if (resetPosition) voice.currentTime = 0;
  }
}

function createVoiceElement(src: string, generation: number): HTMLAudioElement {
  const audio = new Audio();
  audio.preload = "auto";
  audio.volume = VOICE_VOLUME;
  audio.src = src;

  const isCurrent = () => voicePlayback.isCurrent(generation) && voice === audio;
  const onEnded = () => {
    if (!isCurrent()) return;
    voiceRequestedSrc = null;
    useAudioStore.setState({ voicePlayingSrc: null });
    settleAmbientVolume();
  };
  audio.addEventListener("ended", onEnded);
  removeVoiceListeners = () => {
    audio.removeEventListener("ended", onEnded);
  };
  return audio;
}

interface AudioState {
  missionPlaying: boolean;
  ambientStarted: boolean;
  pendingVoiceSrc: string | null;
  voicePlayingSrc: string | null;
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
    if (mission) mission.pause();
    const audio = createMissionElement();
    mission = audio;
    const generation = missionPlayback.begin();
    missionRequested = true;
    removeMissionEnded?.();
    removeMissionEnded = null;

    // A biome voice mid-line steps aside and continues afterwards — and a
    // voice that autoplay held back gets its turn after the mission.
    if (voice && !voice.paused) {
      voiceHeldForMission = true;
      voice.pause();
      set({ voicePlayingSrc: null });
      settleAmbientVolume();
    } else if (voiceRequestedSrc) {
      voiceQueuedBehindMission = voiceRequestedSrc;
      invalidateVoicePlayback(true);
      voiceRequestedSrc = null;
      set({ pendingVoiceSrc: null, voicePlayingSrc: null });
    }
    const pendingSrc = get().pendingVoiceSrc;
    if (pendingSrc) {
      voiceQueuedBehindMission = pendingSrc;
      set({ pendingVoiceSrc: null });
    }

    const finish = () => {
      if (!missionPlayback.isCurrent(generation)) return;
      audio.removeEventListener("ended", finish);
      removeMissionEnded = null;
      missionRequested = false;
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
    removeMissionEnded = () => audio.removeEventListener("ended", finish);

    audio.currentTime = 0;
    audio
      .play()
      .then(() => {
        if (!missionPlayback.isCurrent(generation)) {
          audio.pause();
          return;
        }
        set({ missionPlaying: true });
        settleAmbientVolume();
        trackLandingEvent({
          slug: "landing.mission_voice_played",
          metadata: { src: MISSION_AUDIO_SRC },
        });
      })
      .catch(() => {
        if (!missionPlayback.isCurrent(generation)) return;
        audio.removeEventListener("ended", finish);
        removeMissionEnded = null;
        missionRequested = false;
        if (voiceHeldForMission) {
          voiceHeldForMission = false;
          get().resumeVoice();
        } else if (voiceQueuedBehindMission) {
          const queued = voiceQueuedBehindMission;
          voiceQueuedBehindMission = null;
          get().playVoice(queued);
        }
        settleAmbientVolume();
        onBlocked?.();
      });
  };

  return {
  missionPlaying: false,
  ambientStarted: false,
  pendingVoiceSrc: null,
  voicePlayingSrc: null,

  toggleMission: () => {
    if (missionRequested && mission) {
      const audio = mission;
      // Tap mid-voice: cancel outright and hand the floor back.
      missionPlayback.invalidate();
      missionRequested = false;
      removeMissionEnded?.();
      removeMissionEnded = null;
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
    if (missionRequested) {
      if (voiceHeldForMission) {
        invalidateVoicePlayback(true);
        voiceRequestedSrc = null;
        voiceHeldForMission = false;
      }
      voiceQueuedBehindMission = src;
      set({ pendingVoiceSrc: null, voicePlayingSrc: null });
      return;
    }
    if (voiceToggleAction(get().voicePlayingSrc ?? voiceRequestedSrc, src) === "stop") {
      invalidateVoicePlayback(true);
      voiceRequestedSrc = null;
      set({ pendingVoiceSrc: null, voicePlayingSrc: null });
      settleAmbientVolume();
      return;
    }
    invalidateVoicePlayback(true);
    const generation = voicePlayback.begin();
    voiceGeneration = generation;
    voiceRequestedSrc = src;
    const audio = createVoiceElement(src, generation);
    voice = audio;
    audio
      .play()
      .then(() => {
        if (!voicePlayback.isCurrent(generation) || voice !== audio) {
          audio.pause();
          return;
        }
        set({
          pendingVoiceSrc: null,
          voicePlayingSrc: voiceHeldForMission ? null : src,
        });
        settleAmbientVolume();
        trackLandingEvent({
          slug: "landing.audio_played",
          metadata: { audio_kind: "voice", src },
        });
      })
      .catch(() => {
        if (!voicePlayback.isCurrent(generation) || voice !== audio) return;
        voiceRequestedSrc = null;
        set({ pendingVoiceSrc: src, voicePlayingSrc: null });
        settleAmbientVolume();
      });
  },

  stopVoice: () => {
    invalidateVoicePlayback(true);
    voiceRequestedSrc = null;
    voiceHeldForMission = false;
    voiceQueuedBehindMission = null;
    set({ pendingVoiceSrc: null, voicePlayingSrc: null });
  },

  stopForegroundAudio: () => {
    missionPlayback.invalidate();
    missionRequested = false;
    removeMissionEnded?.();
    removeMissionEnded = null;
    if (mission && !mission.paused) mission.pause();
    if (mission) mission.currentTime = 0;
    invalidateVoicePlayback(true);
    voiceRequestedSrc = null;
    voiceHeldForMission = false;
    voiceQueuedBehindMission = null;
    set({ missionPlaying: false, pendingVoiceSrc: null, voicePlayingSrc: null });
    settleAmbientVolume();
  },

  pauseVoice: () => {
    if (voice && !voice.paused) voice.pause();
    set({ voicePlayingSrc: null });
    settleAmbientVolume();
  },

  resumeVoice: () => {
    if (voice && voice.paused && voice.src && voice.currentTime > 0 && !voice.ended) {
      const audio = voice;
      const src = voiceRequestedSrc;
      const generation = voiceGeneration;
      audio.play().then(() => {
        if (!voicePlayback.isCurrent(generation) || voice !== audio || !src) {
          audio.pause();
          return;
        }
        set({ pendingVoiceSrc: null, voicePlayingSrc: src });
        settleAmbientVolume();
      }).catch(() => {
        if (!voicePlayback.isCurrent(generation) || voice !== audio || !src) return;
        set({ pendingVoiceSrc: src, voicePlayingSrc: null });
        settleAmbientVolume();
      });
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
