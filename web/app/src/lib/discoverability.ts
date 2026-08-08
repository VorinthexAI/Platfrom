export const CANONICAL_ORIGIN = "https://vorinthex.com" as const;
export const CONTENT_LAST_REVIEWED = "2026-08-08" as const;
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
    description: "Write, save, organize, search, and understand your knowledge.",
    promise: "One intelligent home for everything you want to keep.",
    details: [
      "Capture quick thoughts, create polished documents, upload existing work, and organize notes, ideas, research, and knowledge in one simple place.",
      "Powerful search helps you rediscover information, while built-in AI can write, rewrite, summarize, translate, explain, and transform entire documents naturally.",
    ],
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
    description: "Organize, understand, search, and share your visual library.",
    promise: "An intelligent home for your images and memories.",
    details: [
      "Bring photos and images together in beautiful collections, mark favorites, and find what you need without remembering filenames or manually sorting everything.",
      "Gallery understands what your images contain and makes them naturally searchable. Share individual images or build collections where friends, family, and collaborators can contribute.",
    ],
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
    description: "Prioritize email, understand conversations, and write replies in your voice.",
    promise: "Turn an endless inbox into focused communication.",
    details: [
      "Connect your email and Signal separates what matters from what does not, surfaces conversations that need attention, and makes important messages easier to understand.",
      "When it is time to respond, Signal helps write replies that sound like you. It can learn your tone, style, structure, and how you communicate with different people.",
    ],
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
    description: "Map past journeys, future trips, and dream destinations.",
    promise: "Your life across the world, mapped around you.",
    details: [
      "Explore a 3D globe filled with places you have visited, trips you are planning, and destinations you want to experience. Save wish-list places, mark favorites, and build journeys across multiple stops.",
      "Over time, Compass becomes a visual record of where you have been, where you are going, and what remains to be discovered.",
    ],
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
    description: "Personalized audiobooks researched and created around your goals.",
    promise: "A learning experience written specifically for you.",
    details: [
      "Tell Ascend what you want to learn or improve. It researches the subject, understands your goals, builds a unique structure, writes every chapter, creates a cover, and turns the finished book into immersive audio.",
      "Each new book can build on what you have already explored, avoiding repetition and taking your learning deeper over time.",
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
