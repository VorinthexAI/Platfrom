import {
  SPARK_MONTHLY_PLANS,
  formatSparkCount,
  formatUsd,
} from "@/lib/spark-pricing";

export const APP_STORE_URL = "https://www.apple.com/app-store/";
export const GOOGLE_PLAY_URL =
  "https://play.google.com/store/search?q=Vorinthex%20AI&c=apps";

export const CORE_CAPABILITIES = [
  {
    name: "Archive",
    icon: "/logos/entities/capability-archive.png",
    description: "Store, organize and understand everything that matters.",
    promise: "A living home for everything you know.",
    detail:
      "Capture thoughts, documents, links and research without deciding where every idea belongs first. Archive organizes the material around meaning, then brings the right context back when you need it.",
    connection:
      "Archive gives every Core app durable memory, so conversations, plans and coaching can build on what you already know.",
    features: [
      "Notes, ideas, and research",
      "Folders, labels, and backlinks",
      "Semantic search and knowledge connections",
    ],
  },
  {
    name: "Gallery",
    icon: "/logos/entities/capability-gallery.png",
    description: "Your visual memory. Search, recall and connect images.",
    promise: "Remember the story behind every image.",
    detail:
      "Gallery turns a camera roll into an explorable visual memory. Find moments using natural language, understand what connects them and keep the people and places around each image in context.",
    connection:
      "Gallery links visual moments to Archive knowledge, Compass places and the people you communicate with in Signal.",
    features: [
      "Smart albums and visual clusters",
      "Search by people, places, dates, and events",
      "Private sharing links and album invites",
    ],
  },
  {
    name: "Signal",
    icon: "/logos/entities/capability-signal.png",
    description: "Unified communication across people and intelligences.",
    promise: "One calm view of every important conversation.",
    detail:
      "Signal gathers communication into one intelligent stream. It understands priority and shared history, helps prepare thoughtful responses and keeps you in control before anything is sent.",
    connection:
      "Signal can draw on your private Core context to explain references and prepare replies without making conversations another isolated silo.",
    features: [
      "Connect multiple inboxes",
      "Filter noise and prioritize what matters",
      "Draft replies in your tone for approval",
    ],
  },
  {
    name: "Compass",
    icon: "/logos/entities/capability-compass.png",
    description: "Discover knowledge and navigate infinite information.",
    promise: "Turn curiosity into a path you can follow.",
    detail:
      "Compass helps explore places, topics and possibilities while preserving why each discovery matters to you. Move from open research to a grounded plan without losing the trail that led there.",
    connection:
      "Compass connects discoveries to saved knowledge in Archive, visual memories in Gallery and goals being developed in Ascend.",
    features: [
      "Map places, memories, and plans",
      "Keep visited and future destinations together",
      "Turn context into useful itineraries",
    ],
  },
  {
    name: "Ascend",
    icon: "/logos/entities/capability-ascend.png",
    description: "Your AI coach for growth, clarity and mastery.",
    promise: "Progress guided by your real life, not a template.",
    detail:
      "Ascend turns ambitions into practical rhythms. It helps define goals, notice patterns and adapt routines using the context of what you are learning, doing and experiencing across Core.",
    connection:
      "Ascend uses the knowledge, communication and discoveries you choose to connect, creating coaching grounded in your actual priorities.",
    features: [
      "Goals, habits, health, and routines",
      "Personal learning journeys",
      "Coaching grounded in your real context",
    ],
  },
] as const;

export const CORE_FAQ = [
  {
    question: "What is Vorinthex Core?",
    answer:
      "Vorinthex Core is a private personal AI for iOS and Android that connects your knowledge, memories, communication, and goals in one place.",
  },
  {
    question: "What can Core do?",
    answer:
      "Core brings together Archive, Gallery, Signal, Compass, and Ascend so your personal AI can remember context and help across the parts of life that matter to you.",
  },
  {
    question: "How much does Vorinthex Core cost?",
    answer:
      `Planned monthly Sparks options start with ${SPARK_MONTHLY_PLANS[0].name} at ${formatUsd(SPARK_MONTHLY_PLANS[0].price)} for ${formatSparkCount(SPARK_MONTHLY_PLANS[0].sparks)} Sparks. Purchases are not yet available.`,
  },
] as const;
