import { LEGAL_CONTACT_EMAIL, LEGAL_EFFECTIVE_DATE_ISO } from "@vorinthex/shared/lib/legal-copy";
import {
  NEWCOMER_FREE_SPARKS,
  SPARK_PRICING_CURRENCY,
  SPARK_SUBSCRIPTIONS,
  SPARK_TOP_UP,
  REFERRAL_REWARDS,
  STORAGE_SPARKS_PER_GB_MONTH,
  formatSparkCount,
} from "@/lib/spark-pricing";

export const CANONICAL_ORIGIN = "https://vorinthex.com" as const;
export const CONTENT_LAST_REVIEWED = "2026-10-08" as const;
export const CONTACT_EMAIL = LEGAL_CONTACT_EMAIL;
export const PRICING_HERO_HEADING = "One balance for everything you create and use" as const;
export const PRICING_HERO_BODY =
  "Sparks give you a simple way to use AI capabilities, store your work, and keep services connected across Vorinthex." as const;
const STORAGE_PRICING_FACT = `Storage is charged hourly from prepaid Sparks at ${STORAGE_SPARKS_PER_GB_MONTH} Sparks per GB-month.`;

export type PublicRoutePath =
  | "/"
  | "/pricing"
  | "/about"
  | "/contact"
  | "/privacy"
  | "/terms";

export type SchemaPageType = "WebPage" | "AboutPage" | "ContactPage";

export interface PublicRouteEntry {
  path: PublicRoutePath;
  title: string;
  description: string;
  summary: string;
  schemaPageType: SchemaPageType;
  status: "current";
  lastModified: typeof CONTENT_LAST_REVIEWED | typeof LEGAL_EFFECTIVE_DATE_ISO;
  capabilities: readonly string[];
  faq?: readonly { question: string; answer: string }[];
}

export const PRODUCT_PILLARS = [
  {
    id: "storage",
    name: "Storage",
    description: "Keep your files in your own secure cloud space.",
    promise: "A home for your work.",
    details: [
      "Keep your files in your own secure cloud Storage space, ready for you and Core when you need them.",
      "Notes, documents, photos, audio, videos, and Core chats stay together as the story of your work, instead of feeling scattered.",
      "Arrange your work by project and keep what matters close at hand. Core can still find it across your space.",
    ],
  },
  {
    id: "core",
    name: "Core",
    description: "Your personal AI that starts from the work you keep.",
    promise: "An answer that starts from your context.",
    details: [
      "Ask Core about your work in your own words. It can use the content you have chosen to keep in your current scope to find answers and make connections.",
      "Create images, speech, or short videos with Core. What you make is saved with the rest of your work.",
      "Core chats live in Storage, with transcripts and summaries you can find again and bring into a new conversation.",
    ],
  },
  {
    id: "sparks",
    name: "Sparks",
    description: "One unified currency for Storage and Core.",
    promise: "One balance for it all.",
    details: [
      PRICING_HERO_BODY,
      `You start with ${formatSparkCount(NEWCOMER_FREE_SPARKS)} Sparks. One balance covers Storage and Core AI-based usage, across the work you keep and the things you create.`,
    ],
  },
] as const;

export const PRODUCT_FACTS = {
  name: "Vorinthex Core",
  status: "Personal AI for iOS and Android",
  platforms: ["iOS", "Android"],
  availability: "Download Core for your platform.",
  privacy:
    "Core stores your files and chats in your scopes and may use authorized content to answer questions. AI feature requests may be processed by external model providers; the Privacy Policy explains data use and deletion.",
  workspaceContext:
    "Core can answer questions using authorized content in the signed-in user's current scope, including saved documents, files, images, audio, video, and previous Core chats, and can explain the signed-in user's Sparks balance and subscription. Answers distinguish incomplete evidence from confirmed absence. Core also offers separate chat, image, speech, and video modes; generated media is saved privately in the user's current scope.",
  mediaGeneration: "Image generation or editing costs 15 Sparks per image, accepts up to eight reference images, and offers a choice of aspect ratios. Speech generation costs 1 Spark per 100 characters with a choice of five voices and can narrate the extracted text of selected documents, up to 15,000 characters combined. Video generation costs 15 Sparks per second, supports 1–15 seconds at 480p with a five-second default and an optional starting image, and does not edit or extend existing video.",
  fileFormats: "Storage converts selected JPG, PNG, WebP, GIF, and iPhone HEIC/HEIF images to PNG before upload, preserving transparency. MP3 audio and MP4 or MOV videos are stored without transcoding; video captions analyze the video itself.",
  storagePricing: STORAGE_PRICING_FACT,
  sparks:
    `${PRICING_HERO_HEADING}. ${PRICING_HERO_BODY} The current subscriptions are $19.99 monthly for 1,000 Sparks and $7.99 weekly for 200 Sparks. A one-time 200-Spark top-up is $9.99. Purchases are available in the iOS and Android apps, not on the public website. Prepaid Sparks remain available after subscription cancellation, balances never go below zero. ${STORAGE_PRICING_FACT} Workspace reranking during Core search costs 20 Sparks per million processed tokens. Unfunded storage incurs no debt or backcharges, uploads can continue, and existing data remains available for export, deletion, and recovery. Adding enough Sparks before deletion begins restores prospective charging. Once deletion begins, it cannot be reversed. Stored data is permanently deleted after 90 consecutive unfunded days. Website prices are shown in USD; in-app prices and taxes depend on your store and region.`,
  pricing: {
    currency: SPARK_PRICING_CURRENCY,
    newcomerAllocation: NEWCOMER_FREE_SPARKS,
    subscriptions: SPARK_SUBSCRIPTIONS,
    topUp: SPARK_TOP_UP,
    referrals: REFERRAL_REWARDS,
    webPurchasesAvailable: false,
    capabilityCosts: { initialEmailSync: 75, createAudioBook: 75, extendAudioBook: 25 },
  },
  capabilities: PRODUCT_PILLARS,
} as const;

const pillarNames = PRODUCT_PILLARS.map(({ name }) => name);

export const PUBLIC_DISCOVERABILITY_REGISTRY = {
  "/": {
    path: "/",
    title: "Vorinthex AI | Your Personal AI",
    description:
      "Vorinthex AI is your personal AI for iOS and Android. Keep work in Storage, ask Core, and use Sparks as one balance for files and creation.",
    summary:
      "Vorinthex Core is a personal AI for iOS and Android that starts from the work you keep in Storage, answers in chat, and can create private images, speech, and short videos. Sparks are one balance for Storage and Core.",
    schemaPageType: "WebPage",
    status: "current",
    lastModified: CONTENT_LAST_REVIEWED,
    capabilities: [...pillarNames, "Image, speech, and video generation", "HEIC/HEIF photo import and MOV video storage"],
  },
  "/pricing": {
    path: "/pricing",
    title: "Sparks Pricing | Vorinthex AI",
    description: PRICING_HERO_BODY,
    summary: `${PRICING_HERO_HEADING}. ${PRICING_HERO_BODY} ${PRODUCT_FACTS.mediaGeneration} ${PRODUCT_FACTS.storagePricing}`,
    schemaPageType: "WebPage",
    status: "current",
    lastModified: CONTENT_LAST_REVIEWED,
    capabilities: [],
  },
  "/about": {
    path: "/about",
    title: "About Vorinthex AI",
    description:
      "Learn about Vorinthex AI and Core, a personal AI for iOS and Android that starts from the work you keep.",
    summary:
      "Vorinthex AI builds Core, a personal AI that starts from the work you keep in Storage, with Sparks as one balance.",
    schemaPageType: "AboutPage",
    status: "current",
    lastModified: CONTENT_LAST_REVIEWED,
    capabilities: pillarNames,
  },
  "/contact": {
    path: "/contact",
    title: "Contact Vorinthex AI",
    description: `Contact Vorinthex AI at ${CONTACT_EMAIL} about access, press, partnerships, privacy, or support.`,
    summary: `The public contact address for Vorinthex AI is ${CONTACT_EMAIL}.`,
    schemaPageType: "ContactPage",
    status: "current",
    lastModified: CONTENT_LAST_REVIEWED,
    capabilities: [],
  },
  "/privacy": {
    path: "/privacy",
    title: "Privacy Policy | Vorinthex AI",
    description:
      "Learn how Vorinthex AI handles account information, saved content, AI requests, payments, data deletion, and international processing.",
    summary:
      "The Privacy Policy explains how Vorinthex AI handles account data and content, works with service providers, and supports data deletion and privacy requests.",
    schemaPageType: "WebPage",
    status: "current",
    lastModified: LEGAL_EFFECTIVE_DATE_ISO,
    capabilities: [],
  },
  "/terms": {
    path: "/terms",
    title: "Terms of Service | Vorinthex AI",
    description:
      "Read the Terms of Service for Vorinthex AI accounts, Core, prepaid Sparks, subscriptions, storage, and account deletion.",
    summary:
      "The Terms of Service cover account content, AI outputs, prepaid Sparks, subscriptions, unfunded storage, and account closure.",
    schemaPageType: "WebPage",
    status: "current",
    lastModified: LEGAL_EFFECTIVE_DATE_ISO,
    capabilities: [],
  },
} as const satisfies Record<PublicRoutePath, PublicRouteEntry>;

export const PUBLIC_ROUTES = Object.values(PUBLIC_DISCOVERABILITY_REGISTRY);

export function canonicalUrl(path: PublicRoutePath | string): string {
  return `${CANONICAL_ORIGIN}${path === "/" ? "" : path}`;
}
