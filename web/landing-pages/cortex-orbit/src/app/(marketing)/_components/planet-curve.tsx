export function PlanetCurve({
  className = "",
  scale = 1,
}: {
  className?: string;
  scale?: number;
}) {
  return (
    <div
      aria-hidden="true"
      className={`pointer-events-none absolute overflow-hidden ${className}`}
    >
      <div
        className="absolute right-0 bottom-0"
        style={{ transform: `scale(${scale})`, transformOrigin: "bottom right" }}
      >
        <div
          className="absolute rounded-full"
          style={{
            width: "clamp(320px, 42vw, 620px)",
            aspectRatio: "1 / 1",
            right: "-12%",
            bottom: "-28%",
            background:
              "radial-gradient(circle at 32% 28%, #3a3b42 0%, #1a1b1f 42%, #08090a 78%)",
            boxShadow: "0 0 120px 40px rgba(255,255,255,0.03)",
          }}
        />
        <div
          className="absolute rounded-full"
          style={{
            width: "clamp(320px, 42vw, 620px)",
            aspectRatio: "1 / 1",
            right: "-12%",
            bottom: "-28%",
            background:
              "radial-gradient(circle at 27% 21%, rgba(255,255,255,0.95) 0%, rgba(255,255,255,0.35) 3%, transparent 16%)",
          }}
        />
        <div
          className="absolute rounded-full border"
          style={{
            width: "clamp(460px, 58vw, 860px)",
            aspectRatio: "1 / 1",
            right: "calc(-12% - 6vw)",
            bottom: "calc(-28% - 8vw)",
            borderColor: "rgba(255,255,255,0.12)",
            transform: "rotate(-18deg) scaleY(0.42)",
          }}
        />
        <div
          className="absolute rounded-full border"
          style={{
            width: "clamp(520px, 66vw, 960px)",
            aspectRatio: "1 / 1",
            right: "calc(-12% - 10vw)",
            bottom: "calc(-28% - 11vw)",
            borderColor: "rgba(255,255,255,0.06)",
            transform: "rotate(-18deg) scaleY(0.42)",
          }}
        />
      </div>
    </div>
  );
}
