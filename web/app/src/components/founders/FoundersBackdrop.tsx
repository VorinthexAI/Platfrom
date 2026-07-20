/**
 * A low-fidelity obsidian field keeps the workspace atmospheric without
 * competing with its interactive hierarchy or spending a second WebGL loop.
 */
export function FoundersBackdrop() {
  return (
    <>
      <div
        aria-hidden
        className="absolute inset-0"
        style={{
          background:
            "radial-gradient(80% 72% at 55% 43%, #111820 0%, #090d12 48%, #040608 100%)",
        }}
      />
      <div
        aria-hidden
        className="nexus-backdrop-drift pointer-events-none absolute -inset-[8%]"
        style={{
          background:
            "radial-gradient(56% 48% at 66% 35%, rgba(119, 145, 166, 0.08) 0%, transparent 62%), radial-gradient(50% 46% at 28% 72%, rgba(91, 107, 122, 0.06) 0%, transparent 68%), radial-gradient(92% 82% at 50% 50%, transparent 40%, rgba(0, 2, 4, 0.72) 100%)",
        }}
      />
    </>
  );
}
