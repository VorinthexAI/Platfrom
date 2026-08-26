type PausableAudioPlayer = { pause: () => void };

function isReleasedPlayerError(error: unknown) {
  let current = error;
  for (let depth = 0; depth < 4 && current && typeof current === "object"; depth += 1) {
    const message = "message" in current && typeof current.message === "string" ? current.message : "";
    if (message.includes("shared object that was already released") || message.includes("cannot be cast to type class expo.modules.audio.AudioPlayer")) return true;
    current = "cause" in current ? current.cause : undefined;
  }
  return false;
}

export function pauseOwnedPlayer(player: PausableAudioPlayer, active = true) {
  if (!active) return;
  try {
    player.pause();
  } catch (error) {
    if (!isReleasedPlayerError(error)) throw error;
  }
}
