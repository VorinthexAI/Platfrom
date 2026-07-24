export function voiceToggleAction(playingSrc: string | null, requestedSrc: string): "play" | "stop" {
  return playingSrc === requestedSrc ? "stop" : "play";
}
