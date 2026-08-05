export const APP_STORE_URL = "https://www.apple.com/app-store/";
export const GOOGLE_PLAY_URL =
  "https://play.google.com/store/search?q=Vorinthex%20AI&c=apps";

export const CORE_CAPABILITIES = [
  {
    name: "Archive",
    icon: "/logos/entities/capability-archive.png",
    description: "Store, organize and understand everything that matters.",
    price: 9.99,
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
    price: 19.99,
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
    price: 29.99,
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
    price: 14.99,
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
    price: 24.99,
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
      "The Core personal AI foundation is free. Optional Core capabilities are available as monthly subscriptions, starting with Archive at $9.99 per month.",
  },
] as const;
