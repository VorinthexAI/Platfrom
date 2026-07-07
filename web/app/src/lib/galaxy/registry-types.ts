/**
 * Type model for the Vorinthex galaxy registry — the single source of truth
 * for every celestial object, product, capability, orchestrator, and
 * collectible on the landing page. Components must never own content; they
 * render entities.
 */

export type EntityType =
  | "brand"
  | "star"
  | "product"
  | "capability"
  | "orchestrator"
  | "artifact"
  | "collectible"
  | "future";

export type EntityVisibility =
  | "live"
  | "dormant"
  | "teaser"
  | "locked"
  | "hidden";

/** Derived rendering state — see getEntityRenderState(). */
export type RenderState = "hidden" | "active" | "teaser" | "locked" | "dormant";

export type CelestialKind =
  | "star"
  | "planet"
  | "moon"
  | "asteroid"
  | "station"
  | "belt"
  | "fragment";

export type AccentKind =
  | "chrome"
  | "obsidian"
  | "dark-orange-chrome"
  | "silver"
  | "glass"
  | "void";

export interface EntityLogo {
  src: string;
  alt: string;
  kind: "svg" | "png" | "webp" | "model" | "procedural";
  /** Key into the procedural icon set when kind === "procedural". */
  iconKey?: string;
}

export interface EntityVisual {
  celestialKind: CelestialKind;
  /** 0 = the star, 1 = product orbits, children use their own local levels. */
  orbitLevel: number;
  orbitRadius?: number;
  orbitSpeed?: number;
  orbitInclination?: number;
  orbitTilt?: number;
  initialAngle?: number;
  /** Scene scale multiplier for the body. */
  size?: number;
  materialPreset?: string;
  lockedMaterialPreset?: string;
  accent?: AccentKind;
}

export interface EntityRoutes {
  path: string;
  aliases?: string[];
  subdomains?: string[];
  /** Absolute URL or site-relative path; resolved in metadata helpers. */
  canonical?: string;
}

export interface EntitySeo {
  /** Bare title — the layout template appends the brand suffix. */
  title: string;
  description: string;
  keywords?: string[];
  indexable: boolean;
  openGraphImage?: string;
  schemaType?: "Organization" | "WebSite" | "SoftwareApplication" | "Service" | "Product";
}

export interface EntityAeo {
  summary: string;
  questions?: { question: string; answer: string }[];
  llmsText?: string;
}

export interface EntityContent {
  eyebrow?: string;
  headline?: string;
  subheadline?: string;
  body?: string;
  bullets?: string[];
  primaryCta?: string;
  secondaryCta?: string;
  /** One-liner shown on dormant/teaser panels ("Joins the Nexus after Core…"). */
  statusNote?: string;
}

export interface EntityPrice {
  amount: number;
  currency: "USD";
  interval: "month";
}

/** Command-only compute pricing. Never shown on the Core landing surface. */
export interface CommandCoinCosts {
  beginner: number;
  advanced: number;
  pro: number;
  unit: "coins-per-workspace-month";
}

export interface GalaxyEntity {
  id: string;
  slug: string;
  type: EntityType;
  parentId?: string;
  /** Command hierarchy edge (orchestrators only). */
  reportsTo?: string | null;
  name: string;
  label?: string;
  /** Orchestrator role, e.g. "CEO". */
  role?: string;
  /** Orchestrator full title, e.g. "Chief Executive Orchestrator". */
  fullTitle?: string;
  shortDescription: string;
  longDescription?: string;
  tagline?: string;
  isLive: boolean;
  visibility: EntityVisibility;
  launchDate?: string;
  statusLabel?: string;
  logo: EntityLogo;
  visual: EntityVisual;
  routes: EntityRoutes;
  seo: EntitySeo;
  aeo?: EntityAeo;
  content?: EntityContent;
  price?: EntityPrice;
  commandCoins?: CommandCoinCosts;
  children?: string[];
}

export interface CommandPlan {
  id: string;
  name: string;
  priceUsd: number | null;
  monthlyCoins: number | null;
  description: string;
}

export type CollectibleRarity =
  | "common"
  | "uncommon"
  | "rare"
  | "legendary"
  | "founder";

/** A hidden Intelligence Fragment discoverable in the galaxy. */
export interface CollectibleDef {
  id: string;
  slug: string;
  name: string;
  type: "fragment" | "relic" | "blueprint" | "material" | "artifact";
  rarity: CollectibleRarity;
  fragments: number;
  isLive: boolean;
  isClaimable: boolean;
  isDiscoverable: boolean;
  /** World-space position in the galaxy scene. */
  position: [number, number, number];
  parentEntityId?: string;
  rewardId?: string;
}

export interface FragmentReward {
  id: string;
  threshold: number;
  name: string;
  description: string;
}

export interface CommunityMilestone {
  id: string;
  threshold: number;
  label: string;
}

export interface DeepLinkInput {
  pathname: string;
  searchParams?: URLSearchParams;
  hostname?: string;
}
