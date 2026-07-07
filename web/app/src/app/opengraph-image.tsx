import { ImageResponse } from "next/og";
import { SITE_NAME, SITE_TAGLINE } from "@/lib/site";

/**
 * The social share card (Open Graph + Twitter): a quiet obsidian sky with
 * the brand name, tagline, and hero line — generated at build time so link
 * previews always match the live site instead of a stale crawl.
 */

export const alt = `${SITE_NAME} | ${SITE_TAGLINE}`;
export const size = {
  width: 1200,
  height: 630,
};
export const contentType = "image/png";

export default function Image() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          background:
            "radial-gradient(ellipse 90% 70% at 50% 42%, #101820 0%, #050709 55%, #020304 100%)",
          color: "#e8ecef",
          fontFamily: "Georgia, serif",
          textAlign: "center",
        }}
      >
        <div
          style={{
            display: "flex",
            fontSize: 30,
            letterSpacing: 14,
            color: "#8a949c",
            textTransform: "uppercase",
          }}
        >
          {SITE_NAME}
        </div>
        <div
          style={{
            display: "flex",
            marginTop: 34,
            fontSize: 84,
            letterSpacing: 6,
            color: "#f4f6f8",
            textTransform: "uppercase",
          }}
        >
          {SITE_TAGLINE}
        </div>
        <div
          style={{
            display: "flex",
            marginTop: 38,
            fontSize: 32,
            letterSpacing: 2,
            color: "#aeb7be",
          }}
        >
          Your personal AI for everything, with infinite memory.
        </div>
        <div
          style={{
            display: "flex",
            marginTop: 60,
            width: 260,
            height: 2,
            background:
              "linear-gradient(90deg, rgba(232,236,239,0) 0%, rgba(232,236,239,0.55) 50%, rgba(232,236,239,0) 100%)",
          }}
        />
        <div
          style={{
            display: "flex",
            marginTop: 28,
            fontSize: 22,
            letterSpacing: 8,
            color: "#6d767d",
            textTransform: "uppercase",
          }}
        >
          vorinthex.com
        </div>
      </div>
    ),
    size,
  );
}
