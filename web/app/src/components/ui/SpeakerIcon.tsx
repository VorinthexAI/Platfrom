/**
 * A small speaker mark for the audio CTAs. With `animated`, the sound
 * waves breathe in sequence (the `sound-wave` keyframe in globals.css).
 */
export function SpeakerIcon({
  animated = false,
  width = 14,
  height = 14,
}: {
  animated?: boolean;
  width?: number;
  height?: number;
}) {
  return (
    <svg
      width={width}
      height={height}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden
      className="shrink-0"
    >
      <path d="M4 9.5v5h3.5L13 19V5L7.5 9.5H4Z" fill="currentColor" opacity={0.9} />
      <path
        d="M15.8 8.8a4.6 4.6 0 0 1 0 6.4"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        style={
          animated
            ? { animation: "sound-wave 1.5s ease-in-out infinite" }
            : undefined
        }
      />
      <path
        d="M18.4 6.4a8.2 8.2 0 0 1 0 11.2"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        style={
          animated
            ? {
                animation: "sound-wave 1.5s ease-in-out infinite",
                animationDelay: "0.35s",
              }
            : undefined
        }
      />
    </svg>
  );
}
