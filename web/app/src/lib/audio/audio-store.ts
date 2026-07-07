"use client";

import { create } from "zustand";
import { trackLandingEvent } from "@/lib/analytics";

/**
 * The galaxy's sound has two channels:
 * MUSIC is the mission soundtrack started by the header CTA.
 * VOICE is the current world's voiceover.
 */

export const MISSION_AUDIO_SRC = "/audio/brand/mission.mp3";

export function entityAudioUrl(type: string, slug: string): string {
  return `/audio/entities/${type}-${slug}.mp3`;
}

const MUSIC_VOLUME = 0.18;
const MUSIC_DUCKED = 0.07;
const VOICE_VOLUME = 0.9;

let music: HTMLAudioElement | null = null;
let voice: HTMLAudioElement | null = null;

function musicElement(): HTMLAudioElement {
  if (!music) {
    music = new Audio(MISSION_AUDIO_SRC);
    music.loop = true;
    music.preload = "auto";
    music.volume = MUSIC_VOLUME;
  }
  return music;
}

function voiceElement(): HTMLAudioElement {
  if (!voice) {
    voice = new Audio();
    voice.preload = "auto";
    voice.volume = VOICE_VOLUME;
    voice.addEventListener("play", () => {
      if (music) music.volume = MUSIC_DUCKED;
    });
    const restore = () => {
      if (music) music.volume = MUSIC_VOLUME;
    };
    voice.addEventListener("ended", restore);
    voice.addEventListener("pause", restore);
  }
  return voice;
}

interface AudioState {
  pendingVoiceSrc: string | null;
  playMission: () => void;
  playVoice: (src: string) => void;
  stopVoice: () => void;
  resumePending: () => void;
}

export const useAudioStore = create<AudioState>((set, get) => ({
  pendingVoiceSrc: null,

  playMission: () => {
    const audio = musicElement();
    audio.currentTime = 0;
    audio
      .play()
      .then(() => {
        trackLandingEvent({
          slug: "landing.audio_played",
          metadata: { audio_kind: "mission", src: MISSION_AUDIO_SRC },
        });
      })
      .catch(() => {});
  },

  playVoice: (src) => {
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
    set({ pendingVoiceSrc: null });
  },

  resumePending: () => {
    const pending = get().pendingVoiceSrc;
    if (pending) get().playVoice(pending);
  },
}));
