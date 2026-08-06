export const CANONICAL_ORIGIN = "https://vorinthex.com" as const;
export const CONTENT_LAST_REVIEWED = "2026-08-06" as const;
export const CONTACT_EMAIL = "contact@vorinthex.com" as const;

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
  lastModified: typeof CONTENT_LAST_REVIEWED;
  capabilities: readonly string[];
  faq?: readonly { question: string; answer: string }[];
}

export const CORE_CAPABILITIES = [
  {
    id: "archive",
    name: "Archive",
    icon: "/logos/entities/capability-archive.png",
    description: "Store, organize and understand everything that matters.",
    promise: "A living home for everything you know.",
    detail:
      "Capture thoughts, documents, links and research without deciding where every idea belongs first. Archive organizes material around meaning, then brings relevant context back when needed.",
    connection:
      "Archive gives every Core app durable memory, so conversations, plans and coaching can build on saved knowledge.",
    features: [
      "Notes, ideas, and research",
      "Folders, labels, and backlinks",
      "Semantic search and knowledge connections",
    ],
  },
  {
    id: "gallery",
    name: "Gallery",
    icon: "/logos/entities/capability-gallery.png",
    description: "Your visual memory. Search, recall and connect images.",
    promise: "Remember the story behind every image.",
    detail:
      "Gallery turns a camera roll into an explorable visual memory, with natural-language discovery and context around people, places and moments.",
    connection:
      "Gallery links visual moments to Archive knowledge, Compass places and people connected through Signal.",
    features: [
      "Albums and visual clusters",
      "Search by people, places, dates, and events",
      "Private sharing links and album invites",
    ],
  },
  {
    id: "signal",
    name: "Signal",
    icon: "/logos/entities/capability-signal.png",
    description: "Unified communication across people and intelligences.",
    promise: "One calm view of every important conversation.",
    detail:
      "Signal gathers communication into one intelligent stream, identifies priority, preserves shared history and helps prepare responses for approval.",
    connection:
      "Signal draws on Core context to explain references and prepare replies without creating another isolated silo.",
    features: [
      "Connect multiple inboxes",
      "Filter noise and prioritize what matters",
      "Draft replies for your approval",
    ],
  },
  {
    id: "compass",
    name: "Compass",
    icon: "/logos/entities/capability-compass.png",
    description: "Discover knowledge and navigate infinite information.",
    promise: "Turn curiosity into a path you can follow.",
    detail:
      "Compass explores places, topics and possibilities while preserving why each discovery matters, from open research through grounded plans.",
    connection:
      "Compass connects discoveries to Archive knowledge, Gallery memories and goals developed in Ascend.",
    features: [
      "Map places, memories, and plans",
      "Keep visited and future destinations together",
      "Turn context into useful itineraries",
    ],
  },
  {
    id: "ascend",
    name: "Ascend",
    icon: "/logos/entities/capability-ascend.png",
    description: "Your AI coach for growth, clarity and mastery.",
    promise: "Progress guided by your real life, not a template.",
    detail:
      "Ascend turns ambitions into practical rhythms, helping define goals, notice patterns and adapt routines around user-provided context.",
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
    "Privacy and user control are central product principles for Core.",
  sparks:
    "Sparks are the usage unit for Vorinthex services. Pricing is shown in USD, and local taxes may be added where required.",
  pricing: {
    currency: SPARK_PRICING_CURRENCY,
    newcomerAllocation: NEWCOMER_FREE_SPARKS,
    monthlyPlans: SPARK_MONTHLY_PLANS,
    topUps: SPARK_TOP_UPS,
    onDemand: SPARK_ON_DEMAND,
  },
  capabilities: CORE_CAPABILITIES,
} as const;

const capabilityNames = CORE_CAPABILITIES.map(({ name }) => name);

export const PUBLIC_DISCOVERABILITY_REGISTRY = {
  "/": {
    path: "/",
    title: "Vorinthex AI | Your Personal AI",
    description:
      "Meet Vorinthex Core, a personal AI for iOS and Android that connects knowledge, memories, communication, discovery, and goals.",
    summary:
      "Vorinthex Core is a personal AI for iOS and Android that connects the context that matters to you.",
    schemaPageType: "WebPage",
    status: "current",
    lastModified: CONTENT_LAST_REVIEWED,
    capabilities: capabilityNames,
  },
  "/pricing": {
    path: "/pricing",
    title: "Sparks Pricing | Vorinthex AI",
    description:
      "Explore Vorinthex Sparks monthly balances, one-time top-ups, and on-demand usage pricing in USD.",
    summary:
      "Vorinthex Sparks pricing includes monthly balances, one-time top-ups, and on-demand usage in USD.",
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
      "Read how Vorinthex AI handles personal data, privacy requests, retention, security safeguards, and account deletion.",
    summary:
      "Vorinthex AI's privacy policy describes data handling, safeguards, rights, retention, and deletion requests.",
    schemaPageType: "WebPage",
    status: "current",
    lastModified: CONTENT_LAST_REVIEWED,
    capabilities: [],
  },
  "/terms": {
    path: "/terms",
    title: "Terms | Vorinthex AI",
    description:
      "Read the terms governing use of Vorinthex AI websites, apps, services, AI-assisted features, and intellectual property.",
    summary:
      "These terms govern lawful use of Vorinthex AI services and responsibility for reviewing AI-assisted outputs.",
    schemaPageType: "WebPage",
    status: "current",
    lastModified: CONTENT_LAST_REVIEWED,
    capabilities: [],
  },
} as const satisfies Record<PublicRoutePath, PublicRouteEntry>;

export const PUBLIC_ROUTES = Object.values(PUBLIC_DISCOVERABILITY_REGISTRY);

export function canonicalUrl(path: PublicRoutePath | string): string {
  return `${CANONICAL_ORIGIN}${path === "/" ? "" : path}`;
}
import {
  NEWCOMER_FREE_SPARKS,
  SPARK_MONTHLY_PLANS,
  SPARK_ON_DEMAND,
  SPARK_PRICING_CURRENCY,
  SPARK_TOP_UPS,
} from "@/lib/spark-pricing";
