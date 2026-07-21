import type { VideoConfig } from "./types";
import type { VideoTarget } from "./targets";

export function buildVideoPrompt(config: VideoConfig, target: VideoTarget, extraPrompt = ""): string {
  const entity = target.entity;
  const bullets = entity?.content?.bullets?.length ? `Feature ideas: ${entity.content.bullets.join("; ")}.` : "";
  const role = entity?.role ? `Role: ${entity.role}. Full title: ${entity.fullTitle}.` : "";
  return `Create a short premium Vorinthex AI video asset for ${target.name}.

Target:
- Type: ${target.category}
- Slug: ${target.slug}
- Description: ${target.description}
${role}
${bullets}

Visual system:
${config.style.visualLanguage}

Motion system:
${config.style.motionLanguage}

Audio system:
${config.generateAudio ? config.style.audioLanguage : "Silent video only. Do not generate, include, synthesize, render, or attach any audio track."}

Creative direction:
- Use an AI-first product launch asset style, suitable for a generated assets library.
- The video should clearly feel tied to ${target.name}, but avoid literal UI screenshots unless explicitly requested.
- Use abstract cinematic symbols, chrome orbital geometry, dark spatial depth, and controlled light.
- Keep composition clean enough to become a product preview loop.
- No readable text inside the video.
- This asset must be video-only. No music, no sound effects, no voice, no ambience, no generated audio track.

Custom instruction:
${extraPrompt || "Create a clean default hero-loop concept for this target."}

Negative prompt:
${config.style.negativePrompt}
${config.generateAudio ? "No vocals, no speech, no abrupt sound effects, no cheap trailer hits, no busy music." : "No audio track, no music, no sound effects, no voiceover, no ambience."}`;
}
