import { ImageResponse } from "next/og";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

/* eslint-disable @next/next/no-img-element */

export const alt = "Vorinthex AI mobile apps on autopilot";
export const contentType = "image/png";
const cardLine = "Mobile apps, built and grown on autopilot.";

export const size = {
  width: 1200,
  height: 630,
};

export default async function OpenGraphImage() {
  const [logo, appScreenshot] = await Promise.all([
    readFile(join(process.cwd(), "public", "logos", "logo-symbol-512.png")),
    readFile(
      join(process.cwd(), "public", "social", "mobile-apps-screenshot.jpg"),
    ),
  ]);
  const logoSrc = `data:image/png;base64,${logo.toString("base64")}`;
  const screenshotSrc = `data:image/jpeg;base64,${appScreenshot.toString("base64")}`;

  return new ImageResponse(
    (
      <div
        style={{
          alignItems: "center",
          background: "#F8F4EC",
          color: "#1C1A17",
          display: "flex",
          height: "100%",
          justifyContent: "space-between",
          overflow: "hidden",
          padding: "58px 68px",
          position: "relative",
          width: "100%",
        }}
      >
        <div
          style={{
            backgroundImage:
              "linear-gradient(#E4DDD0 1px, transparent 1px), linear-gradient(90deg, #E4DDD0 1px, transparent 1px)",
            backgroundSize: "64px 64px",
            inset: 0,
            opacity: 0.38,
            position: "absolute",
          }}
        />
        <div
          style={{
            background: "#EFE7D9",
            borderRadius: 999,
            height: 360,
            opacity: 0.72,
            position: "absolute",
            right: 24,
            top: -120,
            width: 360,
          }}
        />
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: "26px",
            maxWidth: 675,
            position: "relative",
          }}
        >
          <div style={{ alignItems: "center", display: "flex", gap: 18 }}>
            <img
              alt="Vorinthex AI logo"
              height={54}
              src={logoSrc}
              style={{ display: "block" }}
              width={54}
            />
            <div
              style={{
                color: "#39342C",
                fontSize: 34,
                fontWeight: 500,
              }}
            >
              Vorinthex AI
            </div>
          </div>
          <div
            style={{
              color: "#1C1A17",
              fontSize: 82,
              fontWeight: 300,
              lineHeight: 0.98,
            }}
          >
            {cardLine}
          </div>
          <div
            style={{
              color: "#6B6358",
              fontSize: 30,
              lineHeight: 1.32,
              maxWidth: 620,
            }}
          >
            Build, launch, market, and learn from real app signals with one
            quiet agent system.
          </div>
        </div>
        <div
          style={{
            alignItems: "center",
            background: "#1B1A18",
            border: "1px solid #D8CCBA",
            borderRadius: 46,
            boxShadow: "0 32px 90px rgba(55, 44, 31, 0.22)",
            display: "flex",
            height: 500,
            justifyContent: "center",
            overflow: "hidden",
            position: "relative",
            transform: "rotate(2deg)",
            width: 282,
          }}
        >
          <img
            alt="Mobile app checkout screen"
            height={500}
            src={screenshotSrc}
            style={{
              display: "block",
              height: "100%",
              objectFit: "cover",
              width: "100%",
            }}
            width={282}
          />
        </div>
      </div>
    ),
    size,
  );
}
