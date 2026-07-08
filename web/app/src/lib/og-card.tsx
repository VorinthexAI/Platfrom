import { readFileSync } from "node:fs";
import path from "node:path";
import { ImageResponse } from "next/og";
import type { GalaxyEntity } from "@/lib/galaxy/registry-types";
import { SITE_NAME, SITE_TAGLINE } from "@/lib/site";

/**
 * ONE Open Graph / Twitter card generator for every entity in the galaxy.
 *
 * Colocated `opengraph-image.tsx` / `twitter-image.tsx` route files call
 * `renderEntityOg(entity)` (registry-driven, unique per page) or
 * `renderBrandedOg(...)` for non-registry public routes such as the hunt.
 * Every card pulls the entity's real logo from `public/logos/entities/`
 * when one exists and falls back to the Vorinthex mark, so no per-entity
 * artwork is hand-authored.
 *
 * These files run on the Node.js runtime (the default for metadata image
 * routes), so reading logo bytes from disk at build time is safe.
 */

export const OG_SIZE = { width: 1200, height: 630 } as const;
export const OG_CONTENT_TYPE = "image/png";

const ACCENT_COLORS: Record<string, string> = {
  chrome: "#c9d2d8",
  silver: "#c9d2d8",
  glass: "#bcd7e6",
  "dark-orange-chrome": "#e8944e",
  obsidian: "#9aa4ac",
  void: "#9aa4ac",
};

function accentColor(accent?: string): string {
  return (accent && ACCENT_COLORS[accent]) || "#9aa4ac";
}

/** Registry entity → its static logo path under `public/`, if one ships. */
function entityLogoRelPath(entity: GalaxyEntity): string | null {
  switch (entity.type) {
    case "product":
      return `logos/entities/product-${entity.slug}.png`;
    case "capability":
      return `logos/entities/capability-${entity.slug}.png`;
    case "orchestrator":
      return `logos/entities/orchestrator-${entity.slug}.png`;
    default:
      return null;
  }
}

function readImageDataUri(relPath: string): string | null {
  try {
    const bytes = readFileSync(path.join(process.cwd(), "public", relPath));
    return `data:image/png;base64,${bytes.toString("base64")}`;
  } catch {
    return null;
  }
}

function entityEyebrow(entity: GalaxyEntity): string {
  switch (entity.type) {
    case "orchestrator":
      return `${entity.role ?? "Orchestrator"} · Command`;
    case "capability":
      return "Core Capability";
    case "product":
      return entity.label ?? SITE_NAME;
    case "star":
      return SITE_TAGLINE;
    default:
      return SITE_NAME;
  }
}

function entitySubtitle(entity: GalaxyEntity): string {
  return (
    entity.tagline ??
    entity.content?.drawerLine ??
    entity.shortDescription
  );
}

/** og:image:alt / twitter:image:alt text for an entity — unique per page. */
export function entityOgAlt(entity: GalaxyEntity): string {
  return `${entity.name}: ${entitySubtitle(entity)} — ${SITE_NAME}`;
}

interface CardInput {
  eyebrow: string;
  title: string;
  subtitle: string;
  accent: string;
  logo: string | null;
  badge?: string | null;
}

function Card({ eyebrow, title, subtitle, accent, logo, badge }: CardInput) {
  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        background:
          "radial-gradient(ellipse 90% 70% at 50% 40%, #101820 0%, #050709 55%, #020304 100%)",
        color: "#e8ecef",
        fontFamily: "Georgia, serif",
        textAlign: "center",
        padding: "0 96px",
      }}
    >
      {logo ? (
        // ImageResponse (satori) only understands raw <img>; next/image
        // has no meaning inside an OG card render.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={logo}
          alt=""
          width={168}
          height={168}
          style={{ marginBottom: 44, objectFit: "contain" }}
        />
      ) : null}
      <div
        style={{
          display: "flex",
          fontSize: 26,
          letterSpacing: 12,
          color: accent,
          textTransform: "uppercase",
        }}
      >
        {eyebrow}
      </div>
      <div
        style={{
          display: "flex",
          marginTop: 26,
          fontSize: 82,
          letterSpacing: 4,
          color: "#f4f6f8",
          textTransform: "uppercase",
        }}
      >
        {title}
      </div>
      <div
        style={{
          display: "flex",
          marginTop: 30,
          fontSize: 32,
          letterSpacing: 1,
          color: "#aeb7be",
          maxWidth: 940,
          lineHeight: 1.35,
        }}
      >
        {subtitle}
      </div>
      {badge ? (
        <div
          style={{
            display: "flex",
            marginTop: 38,
            padding: "10px 26px",
            border: `1px solid ${accent}`,
            borderRadius: 999,
            fontSize: 20,
            letterSpacing: 5,
            color: accent,
            textTransform: "uppercase",
          }}
        >
          {badge}
        </div>
      ) : null}
      <div
        style={{
          display: "flex",
          marginTop: badge ? 40 : 56,
          width: 240,
          height: 2,
          background: `linear-gradient(90deg, rgba(232,236,239,0) 0%, ${accent}88 50%, rgba(232,236,239,0) 100%)`,
        }}
      />
      <div
        style={{
          display: "flex",
          marginTop: 26,
          fontSize: 22,
          letterSpacing: 8,
          color: "#6d767d",
          textTransform: "uppercase",
        }}
      >
        vorinthex.com
      </div>
    </div>
  );
}

/** Registry entity → unique branded OG/Twitter card. */
export function renderEntityOg(entity: GalaxyEntity): ImageResponse {
  const logoRel = entityLogoRelPath(entity);
  const logo =
    (logoRel ? readImageDataUri(logoRel) : null) ??
    readImageDataUri("logos/vorinthex-mark.png");

  return new ImageResponse(
    (
      <Card
        eyebrow={entityEyebrow(entity)}
        title={entity.name}
        subtitle={entitySubtitle(entity)}
        accent={accentColor(entity.visual.accent)}
        logo={logo}
        badge={entity.isLive ? null : (entity.statusLabel ?? "Coming soon")}
      />
    ),
    OG_SIZE,
  );
}

interface BrandedOgInput {
  eyebrow: string;
  title: string;
  subtitle: string;
  accent?: string;
  badge?: string | null;
}

/** Non-registry public route → branded OG/Twitter card (e.g. the hunt). */
export function renderBrandedOg({
  eyebrow,
  title,
  subtitle,
  accent,
  badge,
}: BrandedOgInput): ImageResponse {
  return new ImageResponse(
    (
      <Card
        eyebrow={eyebrow}
        title={title}
        subtitle={subtitle}
        accent={accentColor(accent)}
        logo={readImageDataUri("logos/vorinthex-mark.png")}
        badge={badge ?? null}
      />
    ),
    OG_SIZE,
  );
}
