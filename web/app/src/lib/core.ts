export const APP_STORE_URL = "https://www.apple.com/app-store/";
export const GOOGLE_PLAY_URL =
  "https://play.google.com/store/search?q=Vorinthex%20AI&c=apps";

export const CORE_CAPABILITIES = [
  {
    name: "Archive",
    icon: "/logos/entities/capability-archive.png",
    description: "Capture, organize, search, and connect everything that matters.",
  },
  {
    name: "Gallery",
    icon: "/logos/entities/capability-gallery.png",
    description: "Your visual memory, organized into a library that understands context.",
  },
  {
    name: "Signal",
    icon: "/logos/entities/capability-signal.png",
    description: "Communication intelligence that filters noise and keeps you connected.",
  },
  {
    name: "Compass",
    icon: "/logos/entities/capability-compass.png",
    description: "Discover knowledge, map your world, and navigate what matters.",
  },
  {
    name: "Ascend",
    icon: "/logos/entities/capability-ascend.png",
    description: "Your personal AI coach for growth, clarity, habits, and mastery.",
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
] as const;
