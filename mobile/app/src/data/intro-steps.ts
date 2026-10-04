import type { ImageSource } from "expo-image";

export const INTRO_STEPS = [
  {
    title: "You know it's somewhere",
    description: "An idea, a photo, a video, or a document matters to you. Finding it again shouldn't be the hard part.",
  },
  {
    title: "Your work adds up",
    description: "Notes, documents, photos, audio, videos, and Core chats become the story of your work. They shouldn't feel scattered.",
  },
  {
    title: "Start with your context",
    description: "Core doesn't have to start from zero. An answer means more when it builds on what you've chosen to keep.",
  },
  {
    title: "A home for your work",
    description: "Keep your files in your own secure cloud Storage space, ready for you and Core when you need them.",
  },
  {
    title: "Make space your way",
    description: "Leave things close at hand or use folders inside folders. Core can still find what matters across your space.",
  },
  {
    title: "Bring what matters",
    description: "Keep TXT, Markdown, Word and PDF files; JPG, PNG, WebP and GIF images; plus MP3 audio and MP4 videos.",
  },
  {
    title: "A personal AI memory",
    description: "Core can use the saved content available in your current scope to help you find answers and make connections.",
  },
  {
    title: "Ask in your own words",
    description: "Ask Core about your work, explore an idea, or just talk something through. You can keep the conversation going.",
  },
  {
    title: "See what Core found",
    description: "Core gives you the finding in chat. When you want to explore the files behind it, open them in Storage with View files.",
  },
  {
    title: "Create and keep it",
    description: "Create images, videos, or speech with Core. What you make is saved in your current scope and the folder you choose.",
  },
  {
    title: "Choose more than one",
    description: "Long-press a file to select it, then gather other files and folders into the same selection.",
  },
  {
    title: "Let projects change",
    description: "Move or copy your selection between folders as your work finds a new shape.",
  },
  {
    title: "Chats become knowledge",
    description: "Core chats are organized in Storage, with transcripts and summaries you can find again.",
  },
  {
    title: "Pick up an older thread",
    description: "Start a new Core chat with context from existing chats. A new thought doesn't have to start from zero.",
  },
  {
    title: "One balance for it all",
    description: "Sparks are one unified currency for Storage and Core's AI-based usage, across the work you keep and the things you create.",
  },
] as const;

export const INTRO_FRAMES: readonly ImageSource[] = [
  require("../../assets/onboarding/frames/01.jpg"),
  require("../../assets/onboarding/frames/02.jpg"),
  require("../../assets/onboarding/frames/03.jpg"),
  require("../../assets/onboarding/frames/04.jpg"),
  require("../../assets/onboarding/frames/05.jpg"),
  require("../../assets/onboarding/frames/06.jpg"),
  require("../../assets/onboarding/frames/07.jpg"),
  require("../../assets/onboarding/frames/08.jpg"),
  require("../../assets/onboarding/frames/09.jpg"),
  require("../../assets/onboarding/frames/10.jpg"),
  require("../../assets/onboarding/frames/11.jpg"),
  require("../../assets/onboarding/frames/12.jpg"),
  require("../../assets/onboarding/frames/13.jpg"),
  require("../../assets/onboarding/frames/14.jpg"),
  require("../../assets/onboarding/frames/15.jpg"),
];
