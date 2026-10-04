import { LEGAL_CONTACT_EMAIL, LEGAL_EFFECTIVE_DATE_ISO } from "@vorinthex/shared/lib/legal-copy";

export const CANONICAL_ORIGIN = "https://vorinthex.com" as const;
export const CONTENT_LAST_REVIEWED = "2026-10-04" as const;
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

export const CORE_CAPABILITIES = [
  {
    id: "archive",
    name: "Archive",
    icon: "/logos/entities/capability-archive.png",
    description: "Write, save, organize, search, and understand your knowledge.",
    promise: "One intelligent home for everything you want to keep.",
    details: [
      "Capture quick thoughts, create polished documents, upload existing work, and organize notes, ideas, research, and knowledge in one simple place.",
      "Powerful search helps you rediscover information, while built-in AI can write, rewrite, summarize, translate, explain, and transform entire documents naturally.",
      "Core chats appear under Vorinthex AI / Core / Chats. Messages are organized automatically, rolling summaries support continuity, and archived chat content can be searched by meaning later within its private authorized scope.",
    ],
    connection:
      "Archive gives every Core app durable memory, so conversations, plans and coaching can build on saved knowledge.",
    features: [
      "Notes, ideas, and research",
      "Folders, labels, and backlinks",
      "Semantic search and knowledge connections",
      "Private, scoped Core chat history",
    ],
  },
  {
    id: "gallery",
    name: "Gallery",
    icon: "/logos/entities/capability-gallery.png",
    description: "Organize, understand, and search your visual library.",
    promise: "An intelligent home for your images and memories.",
    details: [
      "Bring photos and images together in beautiful collections, mark favorites, and find what you need without remembering filenames or manually sorting everything.",
      "Gallery understands what your images contain and makes them naturally searchable, so you can rediscover visual moments without manually sorting everything.",
      "Saved image highlights, written memories, and named visual identities can provide authorized context for Core answers.",
    ],
    connection:
      "Gallery links visual moments to Archive knowledge, Compass places and people connected through Signal.",
    features: [
      "Albums and visual clusters",
      "Search by people, places, dates, and events",
      "Favorites and curated collections",
    ],
  },
  {
    id: "signal",
    name: "Signal",
    icon: "/logos/entities/capability-signal.png",
    description: "A private inbox for connected email and communication from Vorinthex apps and support.",
    promise: "Keep the communication that matters in one private place.",
    details: [
      "Signal brings connected email together with communication from Vorinthex apps and support in one focused, private inbox.",
      "For connected email, Signal helps prioritize conversations, understand messages, and prepare replies in your voice while keeping every send action under your control.",
    ],
    connection:
      "Signal keeps private communication connected to authorized Core context without creating another isolated silo.",
    features: [
      "Connected email in one private inbox",
      "Vorinthex app communication and support",
      "Connected email replies for your approval",
    ],
  },
  {
    id: "compass",
    name: "Compass",
    icon: "/logos/entities/capability-compass.png",
    description: "Explore the world and view cities on an interactive globe.",
    promise: "Your available destinations, mapped around you.",
    details: [
      "Explore countries on a 3D globe and browse the destination cities available to you.",
      "Compass provides a simple map of your available cities and the world that remains to be discovered.",
    ],
    connection:
      "Compass connects discoveries to Archive knowledge, Gallery memories and goals developed in Ascend.",
    features: [
      "Explore countries on an interactive globe",
      "Browse available destination cities",
      "Connect places with your wider context",
    ],
  },
  {
    id: "ascend",
    name: "Ascend",
    icon: "/logos/entities/capability-ascend.png",
    description: "Personalized audio books researched and created around your goals.",
    promise: "A learning experience written specifically for you.",
    details: [
      "Tell Ascend what you want to learn or improve. It researches the subject, understands your goals, builds a unique structure, writes every chapter, and creates a cover.",
      "Each new audio book can build on what you have already explored, avoiding repetition and taking your learning deeper over time.",
    ],
    connection:
      "Ascend uses knowledge, communication and discoveries a user chooses to connect, grounding guidance in actual priorities.",
    features: [
      "Goals, habits, health, and routines",
      "Personal learning journeys",
      "Coaching grounded in the context you provide",
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
    "Core can answer questions using relevant authorized content across saved documents, files, images, highlights, memories, previous chats, communication, travel guides, trips, and audio books, and can explain the signed-in user's Sparks balance and subscription. Answers distinguish incomplete evidence from confirmed absence. Core also offers separate chat, image, speech, and video modes; generated media is saved privately in the user's current scope.",
  mediaGeneration: "Image generation or editing costs 15 Sparks per image, accepts up to eight reference images, and offers a choice of aspect ratios. Speech generation costs 1 Spark per 100 characters with a choice of five voices and can narrate the extracted text of selected documents, up to 15,000 characters combined. Video generation costs 15 Sparks per second, supports 1–15 seconds at 480p with a five-second default and an optional starting image, and does not edit or extend existing video.",
  fileFormats: "Storage converts selected JPG, PNG, WebP, GIF, and iPhone HEIC/HEIF images to PNG before upload, preserving transparency. MP3 audio and MP4 or MOV videos are stored without transcoding; video captions analyze the video itself.",
  storagePricing: STORAGE_PRICING_FACT,
  sparks:
    `${PRICING_HERO_HEADING}. ${PRICING_HERO_BODY} The current launch subscriptions are $19.99 monthly for 1,000 Sparks (discounted from the $24.99 regular monthly price) and $7.99 weekly for 200 Sparks. A one-time 200-Spark top-up is $9.99. Purchases are not yet available on the public website. Prepaid Sparks remain available after subscription cancellation, balances never go below zero. ${STORAGE_PRICING_FACT} Workspace reranking during Core search costs 20 Sparks per million processed tokens. Unfunded storage incurs no debt or backcharges, uploads can continue, and existing data remains available for export, deletion, and recovery. Adding enough Sparks before deletion begins restores prospective charging. Once deletion begins, it cannot be reversed. Stored data is permanently deleted after 90 consecutive unfunded days. Pricing is shown in USD and excludes VAT and other local taxes; Polar calculates and adds applicable tax at checkout.`,
  pricing: {
    currency: SPARK_PRICING_CURRENCY,
    newcomerAllocation: NEWCOMER_FREE_SPARKS,
    subscriptions: SPARK_SUBSCRIPTIONS,
    topUp: SPARK_TOP_UP,
    referrals: REFERRAL_REWARDS,
    webPurchasesAvailable: false,
    capabilityCosts: { initialEmailSync: 75, createAudioBook: 75, extendAudioBook: 25 },
  },
  capabilities: CORE_CAPABILITIES,
} as const;

const capabilityNames = CORE_CAPABILITIES.map(({ name }) => name);

export const PUBLIC_DISCOVERABILITY_REGISTRY = {
  "/": {
    path: "/",
    title: "Vorinthex AI | Your Personal AI",
    description:
      "Meet Vorinthex Core for iOS and Android: chat with your authorized knowledge or create images, speech, and short videos in separate modes.",
    summary:
      "Vorinthex Core is a personal AI for iOS and Android that answers questions using authorized context and generates private images, speech, and short videos in separate modes.",
    schemaPageType: "WebPage",
    status: "current",
    lastModified: CONTENT_LAST_REVIEWED,
    capabilities: [...capabilityNames, "Image, speech, and video generation", "HEIC/HEIF photo import and MOV video storage"],
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
      "Learn about Vorinthex AI and Core, a personal AI for iOS and Android.",
    summary:
      "Vorinthex AI builds Core around connected personal context, privacy, and user control.",
    schemaPageType: "AboutPage",
    status: "current",
    lastModified: CONTENT_LAST_REVIEWED,
    capabilities: capabilityNames,
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
import {
  NEWCOMER_FREE_SPARKS,
  SPARK_PRICING_CURRENCY,
  SPARK_SUBSCRIPTIONS,
  SPARK_TOP_UP,
  REFERRAL_REWARDS,
  STORAGE_SPARKS_PER_GB_MONTH,
} from "@/lib/spark-pricing";
