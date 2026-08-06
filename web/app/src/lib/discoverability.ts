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
  status: "pre-launch" | "current";
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
      "Capture thoughts, documents, links and research without deciding where every idea belongs first. Archive is planned to organize material around meaning, then bring relevant context back when needed.",
    connection:
      "Archive is planned to give every Core app durable memory, so conversations, plans and coaching can build on saved knowledge.",
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
      "Gallery is planned to turn a camera roll into an explorable visual memory, with natural-language discovery and context around people, places and moments.",
    connection:
      "Gallery is planned to link visual moments to Archive knowledge, Compass places and people connected through Signal.",
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
      "Signal is planned to gather communication into one intelligent stream, identify priority, preserve shared history and help prepare responses for approval.",
    connection:
      "Signal is planned to draw on Core context to explain references and prepare replies without creating another isolated silo.",
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
      "Compass is planned to explore places, topics and possibilities while preserving why each discovery matters, from open research through grounded plans.",
    connection:
      "Compass is planned to connect discoveries to Archive knowledge, Gallery memories and goals developed in Ascend.",
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
      "Ascend is planned to turn ambitions into practical rhythms, helping define goals, notice patterns and adapt routines around user-provided context.",
    connection:
      "Ascend is planned to use knowledge, communication and discoveries a user chooses to connect, grounding guidance in actual priorities.",
    features: [
      "Goals, habits, health, and routines",
      "Personal learning journeys",
      "Coaching grounded in the context you provide",
    ],
  },
] as const;

export const CORE_FAQ = [
  {
    question: "What is Vorinthex Core?",
    answer:
      "Vorinthex Core is a personal AI product in development for iOS and Android. It is planned to connect knowledge, memories, communication, discovery, and goals in one place.",
  },
  {
    question: "Is Vorinthex Core available now?",
    answer:
      "No. Vorinthex Core is pre-launch, and app downloads and purchases are not currently available.",
  },
  {
    question: "What are Sparks?",
    answer:
      "Sparks are a planned usage unit for Vorinthex services. The pricing page shows approved planned amounts in US dollars, but Sparks and subscriptions are not currently purchasable.",
  },
] as const;

export const PRODUCT_FACTS = {
  name: "Vorinthex Core",
  status: "Pre-launch and in development",
  platforms: ["iOS", "Android"],
  availability: "Downloads and purchases are not currently available.",
  privacy:
    "Core is being designed with privacy and user control as product principles.",
  sparks:
    "Sparks are a planned usage unit. Approved planned pricing is shown in USD, but Sparks and subscriptions are not currently purchasable.",
  pricing: {
    currency: SPARK_PRICING_CURRENCY,
    newcomerAllocation: NEWCOMER_FREE_SPARKS,
    monthlyPlans: SPARK_MONTHLY_PLANS,
    topUps: SPARK_TOP_UPS,
    onDemand: SPARK_ON_DEMAND,
  },
  capabilities: CORE_CAPABILITIES,
  faq: CORE_FAQ,
} as const;

const capabilityNames = CORE_CAPABILITIES.map(({ name }) => name);

export const PUBLIC_DISCOVERABILITY_REGISTRY = {
  "/": {
    path: "/",
    title: "Vorinthex AI | Your Personal AI",
    description:
      "Meet Vorinthex Core, a pre-launch personal AI planned for iOS and Android that connects knowledge, memories, communication, discovery, and goals.",
    summary:
      "Vorinthex Core is a pre-launch personal AI planned for iOS and Android; downloads and purchases are not yet available.",
    schemaPageType: "WebPage",
    status: "pre-launch",
    lastModified: CONTENT_LAST_REVIEWED,
    capabilities: capabilityNames,
    faq: CORE_FAQ,
  },
  "/pricing": {
    path: "/pricing",
    title: "Planned Sparks Pricing | Vorinthex AI",
    description:
      "Preview approved planned Vorinthex Sparks amounts in USD. Sparks are a planned usage unit, and purchases are not currently available.",
    summary:
      "This pre-launch page shows approved planned Sparks allocations and USD amounts; purchases are not currently available.",
    schemaPageType: "WebPage",
    status: "pre-launch",
    lastModified: CONTENT_LAST_REVIEWED,
    capabilities: [],
  },
  "/about": {
    path: "/about",
    title: "About Vorinthex AI",
    description:
      "Learn about Vorinthex AI and its work on Core, a pre-launch personal AI planned for iOS and Android.",
    summary:
      "Vorinthex AI is developing Core around connected personal context, privacy, and user control.",
    schemaPageType: "AboutPage",
    status: "pre-launch",
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
