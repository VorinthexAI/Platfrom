import { resolve } from 'node:path';

export const INITIAL_GALLERY_ASSET_PREFIX = 'system/initial-gallery/v1/';

export type InitialGalleryAsset = {
  id: string;
  filename: string;
  description: string;
  sourcePath: string;
  storageKey: string;
  width: number;
  height: number;
};

const descriptions = [
  'Archive is your intelligent AI workspace for organizing notes, documents, files, and ideas in one connected place.',
  'Turn weekly priorities into a focused workspace where plans, documents, and files stay connected.',
  'Open any note and ask AI to summarize, improve, translate, or expand the work already in context.',
  'Take action on any document with editing, listening, search, and AI tools built into the same workspace.',
  'Turn saved knowledge into audio so your most useful ideas can move with you.',
  'Find the right work faster with focused filters, tags, favorites, and search history.',
  'Capture a new folder, document, upload, or scan the moment an idea needs a home.',
  'Move between connected AI apps without losing the context behind your work.',
  'Choose the AI workspaces that fit the way you organize, communicate, explore, and learn.',
  'Compass is your intelligent AI workspace for discovering, saving, and planning meaningful places.',
  'Save places with rich visual context so every destination is easier to remember and revisit.',
  'Explore countries, cities, and places through a personal map shaped by your interests.',
  'See your saved destinations as a visual collection of places worth returning to.',
  'Search for the next destination while keeping your saved travel context close at hand.',
  'Turn a discovery into a saved place or a complete trip from one focused workspace.',
  'Connect the places you care about into journeys you can plan, refine, and remember.',
  'Signal is your intelligent AI workspace for bringing every inbox into one focused place.',
  'See the messages that need attention first, with AI-ready context for every conversation.',
  'Filter your inbox around urgency, importance, purchases, favorites, and the work that matters now.',
  'Create reusable writing tones so every email sounds clear, consistent, and like you.',
  'Give different areas of work their own context, boundaries, and AI-ready workspace.',
  'Ascend is your intelligent AI workspace for creating books, guides, and audio experiences from your ideas.',
  'Turn any subject into an audio book or a custom listening experience built around your goals.',
  'Explore practical guides with chapters, summaries, and audio designed around what you want to learn.',
  'Read or listen at your own pace with clear chapters that make knowledge easier to keep.',
  'Core is the AI that connects your Vorinthex apps, helping you understand and act on your context.',
  'Ask Core about your plans, notes, and systems to get answers grounded in the work you already have.',
  'Create images inside the same intelligent workspace as your ideas, plans, and conversations.',
  'Start a new email, define a writing tone, or add reply context without leaving your inbox.',
  'Ask Signal for the messages that matter, then turn your inbox into focused action.',
  'Use natural language to surface urgent, unread, and important messages across your inbox.',
  'Compose with the right tone and context already connected to the conversation.',
  'Gallery is your intelligent AI workspace for organizing image collections, visual references, and memories.',
  'Turn a collection of images into a focused visual story you can revisit and share.',
  'Generate images, create memories, build highlights, and keep your visual library organized.',
  'Generate images from a prompt, refine them with references, and keep the results in your Gallery.',
  'Create visual memories from the images that matter and keep them connected to your collection.',
  'Bring documents, files, plans, and ideas together in an AI workspace built for long-term clarity.',
  'Search your visual library across connected apps and find the images behind your best ideas.',
] as const;

export const INITIAL_GALLERY_ASSET_MANIFEST: readonly InitialGalleryAsset[] = descriptions.map((description, index) => {
  const id = String(index + 1).padStart(2, '0');
  return {
    id,
    filename: `vorinthex-ai-${id}.png`,
    description,
    sourcePath: resolve(import.meta.dir, '../../assets/initial-gallery/social', `${id}.png`),
    storageKey: `${INITIAL_GALLERY_ASSET_PREFIX}${id}.png`,
    width: 1080,
    height: 1920,
  };
});
