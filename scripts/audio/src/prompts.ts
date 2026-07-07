import type { AudioConfig, AudioMode } from "./types";
import type { AudioTarget } from "./targets";

export function buildAudioPrompt(config: AudioConfig, target: AudioTarget, options: {
  mode: AudioMode;
  duration: number;
  extraPrompt?: string;
  videoPath?: string;
}): string {
  const entity = target.entity;
  const bullets = entity?.content?.bullets?.length ? `Feature ideas: ${entity.content.bullets.join("; ")}.` : "";
  const role = entity?.role ? `Role: ${entity.role}. Full title: ${entity.fullTitle}.` : "";
  const base = options.mode === "tts" ? config.style.ttsLanguage : config.style.soundtrackLanguage;
  return `Create an audio asset for ${target.name}.

Target:
- Type: ${target.category}
- Slug: ${target.slug}
- Description: ${target.description}
${role}
${bullets}

Audio system:
${base}

Timing:
- Exact intended duration: ${options.duration} seconds.
- Pace: ${config.bpm} BPM equivalent pulse, cinematic and controlled.
- The file will be merged later into a Vorinthex AI video with ffmpeg.
${options.videoPath ? `- Reference video path: ${options.videoPath}` : ""}

Creative direction:
- Match the Vorinthex visual identity: obsidian space, chrome geometry, orbital motion, intelligent enterprise software.
- Keep the asset clean enough for product launch loops and UI galleries.
- Create a smooth intro, subtle midsection movement, and a clean tail that can cut at the requested duration.

Custom instruction:
${options.extraPrompt || "Create the default premium audio concept for this target."}

Negative prompt:
${config.style.negativePrompt}`;
}

export function buildDefaultVoiceoverScript(target: AudioTarget): string {
  const entity = target.entity;
  if (target.category === "master-brand") {
    return "Vorinthex AI is the nexus of intelligence. A unified command layer for building, orchestrating, and scaling intelligent systems with clarity and control.";
  }

  if (target.category === "product") {
    return `${target.name} brings focused intelligence into the Vorinthex AI platform. It turns complex work into a clear, controlled product experience.`;
  }

  if (target.category === "capability") {
    const feature = entity?.content?.bullets?.[0];
    return `${target.name} is a Vorinthex AI capability designed for precise, reliable execution.${feature ? ` ${feature}` : ""}`;
  }

  return `${target.name} is a Vorinthex AI orchestrator built to coordinate specialized intelligence with calm precision and operational control.`;
}
