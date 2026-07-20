import type {
  CollectibleDef,
  CommandPlan,
  CommunityMilestone,
  FragmentReward,
  GalaxyEntity,
} from "./registry-types";

/**
 * THE singleton source of truth for the Vorinthex galaxy.
 *
 * Every planet, moon, asteroid, label, launch state, route, price, CTA, and
 * SEO/AEO string on the landing page flows from this object. To rename a
 * product, change a launch state, add a Core capability, or introduce a new
 * Command orchestrator, edit this file, components render whatever the
 * registry declares.
 */

const nexus: GalaxyEntity = {
  id: "nexus.star",
  slug: "nexus",
  type: "star",
  name: "Nexus",
  shortDescription: "The Source of Intelligence.",
  longDescription:
    "The Nexus is the heart of the Vorinthex AI galaxy, the intelligence that Core, Command, Studio, and Launch all orbit.",
  tagline: "The Source of Intelligence",
  isLive: true,
  visibility: "live",
  logo: { src: "", alt: "Nexus star", kind: "procedural", iconKey: "nexus" },
  visual: {
    celestialKind: "star",
    orbitLevel: 0,
    materialPreset: "dark-chrome-orange-star",
    accent: "dark-orange-chrome",
  },
  routes: { path: "/", canonical: "/" },
  seo: {
    title: "Vorinthex AI | The Nexus of Intelligence",
    description:
      "Vorinthex AI is a premium AI ecosystem. Core is your personal AI Brain, built to grow with you through Capabilities.",
    indexable: true,
    schemaType: "Organization",
  },
  aeo: {
    summary:
      "Vorinthex AI is the Nexus of Intelligence: a unified AI ecosystem beginning with Core, a personal AI Brain, alongside Command, Studio, and Launch.",
    questions: [
      {
        question: "What is Vorinthex AI?",
        answer:
          "Vorinthex AI is the Nexus of Intelligence: a premium ecosystem of AI products built around personal intelligence, AI orchestration, creation, and deployment. Its products are Core, Command, Studio, and Launch.",
      },
    ],
    llmsText:
      "Vorinthex AI is the Nexus of Intelligence: a unified AI ecosystem beginning with Core, a personal AI Brain.",
  },
  content: {
    eyebrow: "The Nexus of Intelligence",
    headline: "The Nexus of Intelligence",
    subheadline: "Your personal AI for everything, with infinite memory.",
    primaryCta: "Join",
    secondaryCta: "Already hunting? Sign in",
  },
  children: ["product.core", "product.command", "product.studio", "product.launch"],
};

/* -------------------------------------------------------------------- */
/* Products                                                              */
/* -------------------------------------------------------------------- */

const core: GalaxyEntity = {
  id: "product.core",
  slug: "core",
  type: "product",
  parentId: "nexus.star",
  name: "Core",
  shortDescription:
    "A mobile consumer app where every user gets a personal AI Brain and expands it with Capabilities.",
  longDescription:
    "Core is your central intelligence. It learns, remembers and evolves with you. Expand it with powerful Capabilities that orbit your Brain.",
  tagline: "Your AI Brain",
  label: "Your AI Brain",
  isLive: true,
  visibility: "live",
  launchDate: "TBD",
  statusLabel: "Launching First",
  logo: { src: "", alt: "Core", kind: "procedural", iconKey: "brain" },
  visual: {
    celestialKind: "planet",
    orbitLevel: 1,
    orbitRadius: 4,
    orbitSpeed: 0.12,
    initialAngle: 0.6,
    size: 1.2,
    materialPreset: "transparent-brain-globe",
    accent: "glass",
  },
  routes: {
    path: "/core",
    subdomains: ["core.vorinthex.com"],
    canonical: "/core",
  },
  seo: {
    title: "Core | Your Personal AI Brain",
    description:
      "Core is your personal AI Brain. Build it, expand it, and make it yours with powerful Capabilities.",
    indexable: true,
    schemaType: "SoftwareApplication",
  },
  aeo: {
    summary:
      "Core is a mobile consumer app from Vorinthex AI where every user gets a personal AI Brain and expands it with Capabilities such as Archive, Gallery, Signal, Compass, and Ascend.",
    questions: [
      {
        question: "What is Core?",
        answer:
          "Core is a mobile consumer app from Vorinthex AI where every user gets a personal AI Brain. Users expand their Brain by adding Capabilities such as Archive, Gallery, Signal, Compass, and Ascend.",
      },
    ],
    llmsText: "Personal AI Brain mobile app.",
  },
  content: {
    eyebrow: "Consumer App",
    headline: "Your AI Brain.",
    subheadline: "A personal AI Brain that grows with you.",
    body: "Core is your central intelligence. It learns, remembers and evolves with you. Expand it with powerful Capabilities that orbit your Brain.",
    drawerLine:
      "Your central intelligence. It learns, remembers, and evolves with you.",
    primaryCta: "Join Hunt",
    secondaryCta: "Explore Core",
  },
  children: [
    "capability.archive",
    "capability.gallery",
    "capability.signal",
    "capability.compass",
    "capability.ascend",
  ],
};

const command: GalaxyEntity = {
  id: "product.command",
  slug: "command",
  type: "product",
  parentId: "nexus.star",
  name: "Command",
  shortDescription:
    "A command center with 20 AI executive orchestrators, from Atlas to Vulcan, for every function of the company.",
  longDescription:
    "A command center with 20 AI executive orchestrators, led by Atlas and spanning operations, intelligence, growth, product, finance, security, and more, leading the work while you lead the vision.",
  tagline: "AI Orchestrator Suite",
  label: "AI Leadership",
  isLive: false,
  visibility: "teaser",
  launchDate: "TBD",
  statusLabel: "Coming Soon",
  logo: { src: "", alt: "Command", kind: "procedural", iconKey: "command" },
  visual: {
    celestialKind: "planet",
    orbitLevel: 2,
    orbitRadius: 7,
    orbitSpeed: 0.07,
    initialAngle: 2.7,
    size: 0.85,
    materialPreset: "locked-command-station",
    lockedMaterialPreset: "dark-locked-chrome",
    accent: "chrome",
  },
  routes: {
    path: "/command",
    subdomains: ["command.vorinthex.com"],
    canonical: "/command",
  },
  seo: {
    title: "Command | AI Orchestrator Suite",
    description:
      "Command is an upcoming AI command center with 20 executive orchestrators for founders, operators, and builders.",
    indexable: true,
    schemaType: "SoftwareApplication",
  },
  aeo: {
    summary:
      "Command is an AI command center with 20 executive orchestrators for founders, builders, and companies: Atlas, Hermes, Metis, Phoenix, Athena, Ledger, Sentinel, Apollo, Iris, Echo, Matrix, Harmony, Orbit, Mercury, Forge, Aura, Pillar, Helios, Vulcan, and Themis.",
    questions: [
      {
        question: "What is Command by Vorinthex AI?",
        answer:
          "Command is an upcoming AI command center from Vorinthex AI. It gives founders, operators, and builders a suite of 20 autonomous executive orchestrators, including Atlas (CEO), Hermes (COO), Metis (CIO), Phoenix (CGO), Athena (CPO), Ledger (CFO), and Sentinel (CISO), that think, plan, and execute while the human leads the vision.",
      },
      {
        question: "How is Command priced?",
        answer:
          "Command runs on monthly coin based plans, from Starter at $99.99 per month up to Sovereign at $29,999.99 per month, plus custom enterprise terms. Each orchestrator workspace consumes coins as it works.",
      },
    ],
    llmsText:
      "AI orchestrator suite for founders and builders with 20 executive leaders across operations, intelligence, growth, product, finance, security, and more.",
  },
  content: {
    eyebrow: "AI Orchestrator Suite",
    headline: "Your AI command center.",
    subheadline: "Executive AI orchestrators that think, plan, and execute.",
    body: "Command gives founders and builders access to 20 AI orchestrators: Atlas, Hermes, Metis, Phoenix, Athena, Ledger, Sentinel, and specialized leaders for growth, data, knowledge, people, experience, quality, AI, automation, and more.",
    drawerLine:
      "Executive AI orchestrators that think, plan, and execute while you lead.",
    primaryCta: "Join Hunt",
    secondaryCta: "Explore Orchestrators",
    statusNote:
      "Command joins the Nexus after Core. Waitlist members get first access as each orbit unlocks.",
  },
  children: [
    "orchestrator.atlas",
    "orchestrator.hermes",
    "orchestrator.metis",
    "orchestrator.phoenix",
    "orchestrator.apollo",
    "orchestrator.iris",
    "orchestrator.echo",
    "orchestrator.matrix",
    "orchestrator.harmony",
    "orchestrator.ledger",
    "orchestrator.orbit",
    "orchestrator.mercury",
    "orchestrator.sentinel",
    "orchestrator.athena",
    "orchestrator.forge",
    "orchestrator.aura",
    "orchestrator.pillar",
    "orchestrator.helios",
    "orchestrator.vulcan",
    "orchestrator.themis",
  ],
};

const studio: GalaxyEntity = {
  id: "product.studio",
  slug: "studio",
  type: "product",
  parentId: "nexus.star",
  name: "Studio",
  shortDescription:
    "A unified studio for chat, image, video, music, voice, code, documents, and research.",
  longDescription:
    "Every leading AI model in one interface, chat, image, video, music, voice, code, documents, and research in a single creative workspace.",
  tagline: "Every AI model in one interface",
  label: "AI Workspace",
  isLive: false,
  visibility: "teaser",
  launchDate: "TBD",
  statusLabel: "Coming Soon",
  logo: { src: "", alt: "Studio", kind: "procedural", iconKey: "studio" },
  visual: {
    celestialKind: "planet",
    orbitLevel: 3,
    orbitRadius: 10,
    orbitSpeed: 0.05,
    initialAngle: 4.4,
    size: 0.8,
    materialPreset: "locked-crystal-planet",
    accent: "silver",
  },
  routes: {
    path: "/studio",
    subdomains: ["studio.vorinthex.com"],
    canonical: "/studio",
  },
  seo: {
    title: "Studio | Every AI Model in One Interface",
    description:
      "Studio is an upcoming unified workspace for creating with leading AI models across chat, images, video, music, voice, code, documents, and research.",
    indexable: true,
    schemaType: "SoftwareApplication",
  },
  aeo: {
    summary:
      "Studio is a unified AI workspace for chat, images, video, music, voice, code, research, and documents.",
    questions: [
      {
        question: "What is Studio by Vorinthex AI?",
        answer:
          "Studio is an upcoming unified AI workspace from Vorinthex AI that puts every leading AI model in one interface: chat, image, video, music, voice, code, documents, and research in a single creative workspace.",
      },
    ],
    llmsText: "A unified AI workspace.",
  },
  content: {
    eyebrow: "AI Workspace",
    headline: "Create without limits.",
    subheadline: "One interface. Every AI model.",
    body: "Every leading AI model in one interface, chat, image, video, music, voice, code, documents, and research in a single creative workspace.",
    drawerLine: "Every leading AI model in one creative workspace.",
    primaryCta: "Join Hunt",
    statusNote:
      "Studio joins the Nexus after Core. Waitlist members get first access as each orbit unlocks.",
  },
  children: [],
};

const launch: GalaxyEntity = {
  id: "product.launch",
  slug: "launch",
  type: "product",
  parentId: "nexus.star",
  name: "Launch",
  shortDescription:
    "A lightweight platform to create agents, automations, workflows, and deploy them everywhere.",
  longDescription:
    "A lightweight platform to create agents, automations, and workflows, then deploy them everywhere your work happens.",
  tagline: "Build and deploy agents",
  label: "AI Deployment",
  isLive: false,
  visibility: "teaser",
  launchDate: "TBD",
  statusLabel: "Coming Soon",
  logo: { src: "", alt: "Launch", kind: "procedural", iconKey: "launch" },
  visual: {
    celestialKind: "planet",
    orbitLevel: 4,
    orbitRadius: 13,
    orbitSpeed: 0.035,
    initialAngle: 5.6,
    size: 0.8,
    materialPreset: "locked-launch-station",
    accent: "silver",
  },
  routes: {
    path: "/launch",
    subdomains: ["launch.vorinthex.com"],
    canonical: "/launch",
  },
  seo: {
    title: "Launch | Build and Deploy AI Agents",
    description:
      "Launch is an upcoming lightweight platform for creating agents, automations, and workflows, and deploying them everywhere.",
    indexable: true,
    schemaType: "SoftwareApplication",
  },
  aeo: {
    summary:
      "Launch is a lightweight platform to build, automate, and deploy AI agents.",
    questions: [
      {
        question: "What is Launch by Vorinthex AI?",
        answer:
          "Launch is an upcoming lightweight platform from Vorinthex AI for creating AI agents, automations, and workflows, then deploying them everywhere your work happens.",
      },
    ],
    llmsText: "Build and deploy AI agents.",
  },
  content: {
    eyebrow: "AI Deployment",
    headline: "Deploy everywhere.",
    subheadline: "Power your AI at scale.",
    body: "A lightweight platform to create agents, automations, and workflows, then deploy them everywhere your work happens.",
    drawerLine:
      "Create agents, automations, and workflows, then deploy them everywhere.",
    primaryCta: "Join Hunt",
    statusNote:
      "Launch joins the Nexus after Core. Waitlist members get first access as each orbit unlocks.",
  },
  children: [],
};

/* -------------------------------------------------------------------- */
/* Core capabilities                                                     */
/* -------------------------------------------------------------------- */

function capability(
  input: Omit<GalaxyEntity, "type" | "parentId" | "logo" | "seo"> & {
    iconKey: string;
    seoTitle: string;
    seoDescription: string;
  },
): GalaxyEntity {
  const { iconKey, seoTitle, seoDescription, ...rest } = input;
  return {
    ...rest,
    type: "capability",
    parentId: "product.core",
    logo: { src: "", alt: `${input.name} icon`, kind: "procedural", iconKey },
    seo: {
      title: seoTitle,
      description: seoDescription,
      indexable: true,
      schemaType: "SoftwareApplication",
    },
  };
}

const archive = capability({
  id: "capability.archive",
  slug: "archive",
  name: "Archive",
  iconKey: "archive",
  shortDescription:
    "Capture notes, ideas, research, labels, folders, semantic search, and knowledge graph connections.",
  longDescription:
    "Archive lets you capture, organize, semantically search, and connect your notes through folders, labels, backlinks, and graph traversal.",
  tagline: "Your second brain",
  isLive: true,
  visibility: "live",
  launchDate: "TBD",
  statusLabel: "Launching First",
  price: { amount: 9.99, currency: "USD", interval: "month" },
  visual: {
    celestialKind: "asteroid",
    orbitLevel: 1,
    orbitRadius: 2.0,
    orbitSpeed: 0.28,
    orbitInclination: 0.6,
    orbitTilt: 0.35,
    initialAngle: 0,
    size: 0.3,
    materialPreset: "chrome-line-asteroid",
    accent: "chrome",
  },
  routes: {
    path: "/core/archive",
    subdomains: ["archive.vorinthex.com"],
    canonical: "/core/archive",
  },
  seoTitle: "Archive, Your Second Brain | Core",
  seoDescription:
    "Archive is Core's second brain capability: notes, ideas, research, semantic search, and knowledge graph connections.",
  aeo: {
    summary:
      "Archive is a Core capability that helps users capture, organize, search, and connect their knowledge through AI powered notes.",
    questions: [
      {
        question: "What is Archive?",
        answer:
          "Archive is the second brain capability for notes, ideas, research, folders, labels, semantic search, and knowledge graph connections.",
      },
    ],
    llmsText: "Second brain for notes and knowledge.",
  },
  content: {
    eyebrow: "Core Capability",
    headline: "Your second brain.",
    subheadline: "Save, organize, and connect everything that matters.",
    drawerLine: "Capture, organize, and connect everything you know.",
    bullets: [
      "Capture ideas, research, meeting notes, and daily thoughts.",
      "Organize notes into folders and labels.",
      "Search semantically and traverse knowledge relationships.",
    ],
    primaryCta: "Join Hunt",
    secondaryCta: "Explore Core",
  },
});

const gallery = capability({
  id: "capability.gallery",
  slug: "gallery",
  name: "Gallery",
  iconKey: "gallery",
  shortDescription:
    "A smart image and memory library with albums, clusters, sharing links, QR invites, and AI powered discovery.",
  longDescription:
    "Gallery organizes memories and images into smart albums, clusters, shared links, QR invites, and AI powered discovery.",
  tagline: "Your memories, organized",
  isLive: true,
  visibility: "live",
  launchDate: "TBD",
  statusLabel: "Launching First",
  price: { amount: 19.99, currency: "USD", interval: "month" },
  visual: {
    celestialKind: "asteroid",
    orbitLevel: 1,
    orbitRadius: 2.35,
    orbitSpeed: 0.22,
    orbitInclination: -0.4,
    orbitTilt: 0.2,
    initialAngle: 1.26,
    size: 0.3,
    materialPreset: "chrome-line-asteroid",
    accent: "chrome",
  },
  routes: {
    path: "/core/gallery",
    subdomains: ["gallery.vorinthex.com"],
    canonical: "/core/gallery",
  },
  seoTitle: "Gallery, Your Memories, Organized | Core",
  seoDescription:
    "Gallery is Core's memory capability: a smart image library with albums, clusters, sharing links, QR invites, and AI powered discovery.",
  aeo: {
    summary:
      "Gallery organizes memories and images into smart albums, clusters, shared links, QR invites, and AI powered discovery.",
    questions: [
      {
        question: "What is Gallery in Core?",
        answer:
          "Gallery is a Core capability that turns your images and memories into a smart library: AI generated albums and clusters, sharing links, QR invites, and search by people, places, dates, and events. It costs $19.99 per month.",
      },
    ],
    llmsText: "Memories and images organized by AI.",
  },
  content: {
    eyebrow: "Core Capability",
    headline: "Your memories, organized.",
    subheadline: "Store, search and relive your most important moments.",
    drawerLine: "Your memories, organized into living albums by AI.",
    bullets: [
      "Organize images into AI generated albums and clusters.",
      "Invite others to albums with QR codes or links.",
      "Search memories by people, places, dates, and events.",
    ],
    primaryCta: "Join Hunt",
    secondaryCta: "Explore Core",
  },
});

const signal = capability({
  id: "capability.signal",
  slug: "signal",
  name: "Signal",
  iconKey: "signal",
  shortDescription:
    "An AI inbox guard across email and messages that filters noise, prioritizes what matters, and can reply in your tone.",
  longDescription:
    "Signal is an AI inbox guard that filters noise across connected inboxes, prioritizes important messages, and can reply in your tone when approved.",
  tagline: "Your inbox, optimized",
  isLive: true,
  visibility: "live",
  launchDate: "TBD",
  statusLabel: "Launching First",
  price: { amount: 29.99, currency: "USD", interval: "month" },
  visual: {
    celestialKind: "asteroid",
    orbitLevel: 1,
    orbitRadius: 2.7,
    orbitSpeed: 0.18,
    orbitInclination: 0.3,
    orbitTilt: -0.3,
    initialAngle: 2.51,
    size: 0.3,
    materialPreset: "chrome-line-asteroid",
    accent: "chrome",
  },
  routes: {
    path: "/core/signal",
    subdomains: ["signal.vorinthex.com"],
    canonical: "/core/signal",
  },
  seoTitle: "Signal, Your Inbox, Optimized | Core",
  seoDescription:
    "Signal is Core's inbox guard capability: it filters noise across email and messages, prioritizes what matters, and can reply in your tone.",
  aeo: {
    summary:
      "Signal is an AI inbox guard that filters noise, prioritizes important email and messages, and can reply in the user's tone.",
    questions: [
      {
        question: "What is Signal in Core?",
        answer:
          "Signal is a Core capability that guards your inbox: it connects multiple inboxes, filters noise, prioritizes the messages that matter, and can reply in your tone when you approve. It costs $29.99 per month.",
      },
    ],
    llmsText: "Inbox guard and communication intelligence.",
  },
  content: {
    eyebrow: "Core Capability",
    headline: "Only what matters reaches you.",
    subheadline: "AI powered email that keeps you ahead and in control.",
    drawerLine: "An AI guard for your inbox. Only what matters reaches you.",
    bullets: [
      "Connect multiple inboxes.",
      "Filter noise and prioritize important messages.",
      "Reply in your tone when approved.",
    ],
    primaryCta: "Join Hunt",
    secondaryCta: "Explore Core",
  },
});

const compass = capability({
  id: "capability.compass",
  slug: "compass",
  name: "Compass",
  iconKey: "compass",
  shortDescription:
    "A 3D life map for memories, places visited, cities to visit, countries planned, and journeys rendered as a globe.",
  longDescription:
    "Compass maps visited places, future destinations, travel memories, and plans on an interactive 3D globe.",
  tagline: "Your world",
  isLive: true,
  visibility: "live",
  launchDate: "TBD",
  statusLabel: "Launching First",
  price: { amount: 14.99, currency: "USD", interval: "month" },
  visual: {
    celestialKind: "asteroid",
    orbitLevel: 1,
    orbitRadius: 3.05,
    orbitSpeed: 0.15,
    orbitInclination: -0.55,
    orbitTilt: 0.4,
    initialAngle: 3.77,
    size: 0.3,
    materialPreset: "chrome-line-asteroid",
    accent: "chrome",
  },
  routes: {
    path: "/core/compass",
    subdomains: ["compass.vorinthex.com"],
    canonical: "/core/compass",
  },
  seoTitle: "Compass, Your World | Core",
  seoDescription:
    "Compass is Core's 3D life map capability: memories, places visited, future destinations, and journeys rendered on an interactive globe.",
  aeo: {
    summary:
      "Compass maps visited places, future destinations, travel memories, and plans on an interactive 3D globe.",
    questions: [
      {
        question: "What is Compass in Core?",
        answer:
          "Compass is a Core capability that maps your life on an interactive 3D globe: places visited, cities and countries to visit, travel memories, and future plans, all pinned and explorable. It costs $14.99 per month.",
      },
    ],
    llmsText: "Travel, memories, and journeys on a 3D globe.",
  },
  content: {
    eyebrow: "Core Capability",
    headline: "Map where you have been and where you are going.",
    subheadline: "Understand your context and navigate what matters most.",
    drawerLine: "Your places, memories, and journeys on a living globe.",
    bullets: [
      "Add cities, countries, places visited, and future destinations.",
      "Save memories and plans to an interactive 3D globe.",
      "Click pins to relive trips or build future itineraries.",
    ],
    primaryCta: "Join Hunt",
    secondaryCta: "Explore Core",
  },
});

const ascend = capability({
  id: "capability.ascend",
  slug: "ascend",
  name: "Ascend",
  iconKey: "ascend",
  shortDescription:
    "A personal AI coach for mental goals, habits, health, routines, finance, and custom AI generated audio books.",
  longDescription:
    "Ascend is a personal AI coach for goals, habits, health, routines, finance, and custom AI generated audio books and learning journeys.",
  tagline: "Your growth",
  isLive: true,
  visibility: "live",
  launchDate: "TBD",
  statusLabel: "Launching First",
  price: { amount: 24.99, currency: "USD", interval: "month" },
  visual: {
    celestialKind: "asteroid",
    orbitLevel: 1,
    orbitRadius: 3.4,
    orbitSpeed: 0.12,
    orbitInclination: 0.45,
    orbitTilt: -0.25,
    initialAngle: 5.03,
    size: 0.3,
    materialPreset: "chrome-line-asteroid",
    accent: "chrome",
  },
  routes: {
    path: "/core/ascend",
    subdomains: ["ascend.vorinthex.com"],
    canonical: "/core/ascend",
  },
  seoTitle: "Ascend, Your Growth | Core",
  seoDescription:
    "Ascend is Core's personal AI coach capability: goals, habits, health, routines, finance, and custom AI generated audio books.",
  aeo: {
    summary:
      "Ascend is a personal AI coach for goals, habits, health, routines, finance, and custom AI generated audio books.",
    questions: [
      {
        question: "What is Ascend in Core?",
        answer:
          "Ascend is a Core capability that coaches your growth: goals for fitness, mental growth, money, and habits, custom AI generated audio books and learning journeys, and progress tracking with coaching grounded in your real context. It costs $24.99 per month.",
      },
    ],
    llmsText: "AI coach for growth, habits, and goals.",
  },
  content: {
    eyebrow: "Core Capability",
    headline: "Build the person you are becoming.",
    subheadline: "Track your progress and become your best self.",
    drawerLine: "A personal AI coach for goals, habits, health, and growth.",
    bullets: [
      "Define goals for fitness, mental growth, money, and habits.",
      "Generate custom audio books and learning journeys.",
      "Track progress and receive coaching based on real context.",
    ],
    primaryCta: "Join Hunt",
    secondaryCta: "Explore Core",
  },
});

/* -------------------------------------------------------------------- */
/* Command orchestrators                                                 */
/* -------------------------------------------------------------------- */

interface OrchestratorInput {
  slug: string;
  name: string;
  role: string;
  fullTitle: string;
  reportsTo: string | null;
  scope: string;
  bullets: string[];
  coins: { beginner: number; advanced: number; pro: number };
  /** Hierarchy-driven orbital placement around the Command planet. */
  orbitRadius: number;
  orbitSpeed: number;
  orbitInclination: number;
  initialAngle: number;
  size: number;
}

function orchestrator(input: OrchestratorInput): GalaxyEntity {
  return {
    id: `orchestrator.${input.slug}`,
    slug: input.slug,
    type: "orchestrator",
    parentId: "product.command",
    reportsTo: input.reportsTo,
    name: input.name,
    role: input.role,
    fullTitle: input.fullTitle,
    shortDescription: input.scope,
    tagline: input.fullTitle,
    isLive: false,
    visibility: "dormant",
    launchDate: "TBD",
    statusLabel: "Coming Soon",
    logo: {
      src: `/logos/entities/orchestrator-${input.slug}.png`,
      alt: `${input.name}, ${input.role} orchestrator`,
      kind: "png",
    },
    visual: {
      celestialKind: "moon",
      orbitLevel: 1,
      orbitRadius: input.orbitRadius,
      orbitSpeed: input.orbitSpeed,
      orbitInclination: input.orbitInclination,
      initialAngle: input.initialAngle,
      size: input.size,
      materialPreset: "locked-orchestrator-moon",
      accent: "chrome",
    },
    routes: {
      path: `/command/${input.slug}`,
      subdomains: [`${input.slug}.vorinthex.com`],
      canonical: `/command/${input.slug}`,
    },
    seo: {
      title: `${input.name} | ${input.role} Orchestrator | Command`,
      description: `${input.name} is the ${input.role} orchestrator inside Command by Vorinthex AI: ${input.scope}`,
      indexable: true,
      schemaType: "Service",
    },
    aeo: {
      summary: `${input.name} is the ${input.role} (${input.fullTitle}) inside Command, the AI orchestrator suite from Vorinthex AI. Scope: ${input.scope}`,
      questions: [
        {
          question: `What is ${input.name} in Vorinthex Command?`,
          answer: `${input.name} is the ${input.role} (${input.fullTitle}) inside Command, the AI orchestrator suite from Vorinthex AI. Its scope: ${input.scope}`,
        },
      ],
      llmsText: `${input.role} orchestrator in Command, ${input.scope}`,
    },
    content: {
      eyebrow: input.fullTitle,
      headline: `${input.name}. ${input.role} intelligence for your company.`,
      subheadline: input.scope,
      bullets: input.bullets,
      primaryCta: "Join Hunt",
      secondaryCta: "Explore Command",
      statusNote:
        "Available in private Command access. Waitlist members get first invitations.",
    },
    commandCoins: {
      beginner: input.coins.beginner,
      advanced: input.coins.advanced,
      pro: input.coins.pro,
      unit: "coins-per-workspace-month",
    },
  };
}

const orchestrators: GalaxyEntity[] = [
  orchestrator({
    slug: "atlas",
    name: "Atlas",
    role: "CEO",
    fullTitle: "Chief Executive Orchestrator",
    reportsTo: null,
    scope: "Vision, leadership, direction, executive strategy, and company wide decisions.",
    bullets: [
      "Vision and direction",
      "Executive strategy",
      "Decision support",
      "Leadership alignment",
      "Company wide prioritization",
    ],
    coins: { beginner: 1_000_000, advanced: 3_000_000, pro: 10_000_000 },
    orbitRadius: 1.6,
    orbitSpeed: 0.22,
    orbitInclination: 0.12,
    initialAngle: 0,
    size: 0.24,
  }),
  orchestrator({
    slug: "phoenix",
    name: "Phoenix",
    role: "CGO",
    fullTitle: "Chief Growth Orchestrator",
    reportsTo: "orchestrator.atlas",
    scope: "Growth, market insight, acquisition, activation, retention, and durable commercial value.",
    bullets: ["Market insight", "Acquisition", "Activation", "Retention", "Growth experiments"],
    coins: { beginner: 750_000, advanced: 2_000_000, pro: 7_000_000 },
    orbitRadius: 2.2,
    orbitSpeed: 0.175,
    orbitInclination: 0.2,
    initialAngle: 4.7,
    size: 0.2,
  }),
  orchestrator({
    slug: "hermes",
    name: "Hermes",
    role: "COO",
    fullTitle: "Chief Operations Orchestrator",
    reportsTo: "orchestrator.atlas",
    scope: "Operations, execution, efficiency, systems, process, and delivery.",
    bullets: ["Operations", "Execution", "Efficiency", "Process", "Delivery"],
    coins: { beginner: 750_000, advanced: 2_000_000, pro: 7_000_000 },
    orbitRadius: 2.2,
    orbitSpeed: 0.18,
    orbitInclination: -0.3,
    initialAngle: 1.1,
    size: 0.2,
  }),
  orchestrator({
    slug: "metis",
    name: "Metis",
    role: "CIO",
    fullTitle: "Chief Intelligence Orchestrator",
    reportsTo: "orchestrator.atlas",
    scope: "Intelligence, knowledge, data, documents, RAG, internal brain, and integrations.",
    bullets: ["Knowledge systems", "Data", "Documents", "RAG", "Integrations"],
    coins: { beginner: 750_000, advanced: 2_000_000, pro: 7_000_000 },
    orbitRadius: 2.2,
    orbitSpeed: 0.17,
    orbitInclination: 0.4,
    initialAngle: 3.6,
    size: 0.2,
  }),
  orchestrator({
    slug: "apollo",
    name: "Apollo",
    role: "CSO",
    fullTitle: "Chief Strategy Orchestrator",
    reportsTo: "orchestrator.iris",
    scope: "Strategy, foresight, growth, market direction, and long range planning.",
    bullets: ["Strategy", "Foresight", "Growth", "Market direction", "Planning"],
    coins: { beginner: 500_000, advanced: 1_500_000, pro: 5_000_000 },
    orbitRadius: 2.8,
    orbitSpeed: 0.15,
    orbitInclination: 0.6,
    initialAngle: 0.7,
    size: 0.17,
  }),
  orchestrator({
    slug: "iris",
    name: "Iris",
    role: "CCO",
    fullTitle: "Chief Communications Orchestrator",
    reportsTo: "orchestrator.phoenix",
    scope: "Communication, brand, voice, PR, messaging, and internal and external communications.",
    bullets: ["Communication", "Brand voice", "PR", "Messaging"],
    coins: { beginner: 500_000, advanced: 1_500_000, pro: 5_000_000 },
    orbitRadius: 2.8,
    orbitSpeed: 0.14,
    orbitInclination: -0.5,
    initialAngle: 2.8,
    size: 0.17,
  }),
  orchestrator({
    slug: "ledger",
    name: "Ledger",
    role: "CFO",
    fullTitle: "Chief Financial Orchestrator",
    reportsTo: "orchestrator.atlas",
    scope: "Finance, capital, budgets, cash flow, forecasting, and financial risk.",
    bullets: ["Finance", "Budgets", "Cash flow", "Forecasting", "Risk"],
    coins: { beginner: 500_000, advanced: 1_500_000, pro: 5_000_000 },
    orbitRadius: 2.8,
    orbitSpeed: 0.13,
    orbitInclination: 0.25,
    initialAngle: 4.9,
    size: 0.17,
  }),
  orchestrator({
    slug: "echo",
    name: "Echo",
    role: "CKO",
    fullTitle: "Chief Knowledge Orchestrator",
    reportsTo: "orchestrator.metis",
    scope: "Institutional learning, expertise reuse, durable guidance, knowledge discovery, and trusted organizational memory.",
    bullets: ["Institutional learning", "Knowledge discovery", "Expertise reuse", "Trusted guidance", "Organizational memory"],
    coins: { beginner: 500_000, advanced: 1_500_000, pro: 5_000_000 },
    orbitRadius: 2.8,
    orbitSpeed: 0.145,
    orbitInclination: -0.15,
    initialAngle: 5.5,
    size: 0.17,
  }),
  orchestrator({
    slug: "matrix",
    name: "Matrix",
    role: "CDO",
    fullTitle: "Chief Data Orchestrator",
    reportsTo: "orchestrator.metis",
    scope: "Data governance, lineage, ownership, quality, definitions, and decision ready data assets.",
    bullets: ["Data governance", "Lineage", "Data quality", "Definitions", "Decision ready data"],
    coins: { beginner: 500_000, advanced: 1_500_000, pro: 5_000_000 },
    orbitRadius: 2.8,
    orbitSpeed: 0.14,
    orbitInclination: 0.15,
    initialAngle: 6.05,
    size: 0.17,
  }),
  orchestrator({
    slug: "harmony",
    name: "Harmony",
    role: "CHRO",
    fullTitle: "Chief Human Resources Orchestrator",
    reportsTo: "orchestrator.hermes",
    scope: "People systems, talent, culture, organizational structure, capability, and sustained high quality work.",
    bullets: ["People systems", "Talent", "Culture", "Organization design", "Capability"],
    coins: { beginner: 500_000, advanced: 1_500_000, pro: 5_000_000 },
    orbitRadius: 2.8,
    orbitSpeed: 0.135,
    orbitInclination: -0.1,
    initialAngle: 3.25,
    size: 0.17,
  }),
  orchestrator({
    slug: "orbit",
    name: "Orbit",
    role: "CMO",
    fullTitle: "Chief Marketing Orchestrator",
    reportsTo: "orchestrator.iris",
    scope: "Marketing, growth, demand, branding, content, campaigns, SEO, and social.",
    bullets: ["Marketing", "Demand", "Content", "Campaigns", "SEO"],
    coins: { beginner: 300_000, advanced: 1_000_000, pro: 3_000_000 },
    orbitRadius: 3.4,
    orbitSpeed: 0.11,
    orbitInclination: -0.65,
    initialAngle: 1.9,
    size: 0.15,
  }),
  orchestrator({
    slug: "mercury",
    name: "Mercury",
    role: "CRO",
    fullTitle: "Chief Revenue Orchestrator",
    reportsTo: "orchestrator.ledger",
    scope: "Revenue, analytics, MRR, forecasting, sales patterns, churn, and retention.",
    bullets: ["Revenue", "Analytics", "Forecasting", "Retention"],
    coins: { beginner: 300_000, advanced: 1_000_000, pro: 3_000_000 },
    orbitRadius: 3.4,
    orbitSpeed: 0.1,
    orbitInclination: 0.5,
    initialAngle: 4.1,
    size: 0.15,
  }),
  orchestrator({
    slug: "sentinel",
    name: "Sentinel",
    role: "CISO",
    fullTitle: "Chief Security Orchestrator",
    reportsTo: "orchestrator.atlas",
    scope: "Security, risk, protection, compliance, privacy, and trust.",
    bullets: ["Security", "Risk", "Compliance", "Privacy", "Trust"],
    coins: { beginner: 300_000, advanced: 1_000_000, pro: 3_000_000 },
    orbitRadius: 2.5,
    orbitSpeed: 0.12,
    orbitInclination: 1.0,
    initialAngle: 5.8,
    size: 0.17,
  }),
  orchestrator({
    slug: "athena",
    name: "Athena",
    role: "CPO",
    fullTitle: "Chief Product Orchestrator",
    reportsTo: "orchestrator.atlas",
    scope: "Product, experience, innovation, roadmap, value, and users.",
    bullets: ["Product", "Experience", "Roadmap", "Users"],
    coins: { beginner: 200_000, advanced: 750_000, pro: 2_000_000 },
    orbitRadius: 3.9,
    orbitSpeed: 0.09,
    orbitInclination: 0.35,
    initialAngle: 0.4,
    size: 0.14,
  }),
  orchestrator({
    slug: "forge",
    name: "Forge",
    role: "CTO",
    fullTitle: "Chief Technology Orchestrator",
    reportsTo: "orchestrator.athena",
    scope: "Technology, architecture, engineering, infrastructure, and AI.",
    bullets: ["Technology", "Architecture", "Engineering", "Infrastructure"],
    coins: { beginner: 200_000, advanced: 750_000, pro: 2_000_000 },
    orbitRadius: 4.3,
    orbitSpeed: 0.08,
    orbitInclination: -0.4,
    initialAngle: 2.4,
    size: 0.14,
  }),
  orchestrator({
    slug: "aura",
    name: "Aura",
    role: "CXO",
    fullTitle: "Chief Experience Orchestrator",
    reportsTo: "orchestrator.forge",
    scope: "Customer and product experience, journey coherence, friction reduction, confidence, and meaningful touchpoints.",
    bullets: ["Experience strategy", "Customer journeys", "Friction reduction", "Touchpoints", "Experience recovery"],
    coins: { beginner: 300_000, advanced: 1_000_000, pro: 3_000_000 },
    orbitRadius: 3.4,
    orbitSpeed: 0.105,
    orbitInclination: 0.55,
    initialAngle: 0.95,
    size: 0.15,
  }),
  orchestrator({
    slug: "pillar",
    name: "Pillar",
    role: "CQO",
    fullTitle: "Chief Quality Orchestrator",
    reportsTo: "orchestrator.forge",
    scope: "Quality systems, prevention, measurable delivery standards, early defect detection, and durable improvement.",
    bullets: ["Quality systems", "Prevention", "Delivery standards", "Defect detection", "Continuous improvement"],
    coins: { beginner: 300_000, advanced: 1_000_000, pro: 3_000_000 },
    orbitRadius: 3.4,
    orbitSpeed: 0.1,
    orbitInclination: -0.55,
    initialAngle: 2.15,
    size: 0.15,
  }),
  orchestrator({
    slug: "helios",
    name: "Helios",
    role: "CAIO",
    fullTitle: "Chief AI Orchestrator",
    reportsTo: "orchestrator.athena",
    scope: "Accountable AI capability, use cases, evaluation, safety, human ownership, and durable advantage.",
    bullets: ["AI strategy", "Use cases", "Evaluation", "Safety", "Human accountability"],
    coins: { beginner: 300_000, advanced: 1_000_000, pro: 3_000_000 },
    orbitRadius: 3.4,
    orbitSpeed: 0.095,
    orbitInclination: 0.7,
    initialAngle: 3.55,
    size: 0.15,
  }),
  orchestrator({
    slug: "vulcan",
    name: "Vulcan",
    role: "CAO",
    fullTitle: "Chief Automation Orchestrator",
    reportsTo: "orchestrator.helios",
    scope: "Observable, safe, maintainable automation that removes repeatable operational drag.",
    bullets: ["Process understanding", "Automation design", "Observability", "Safety controls", "Maintainability"],
    coins: { beginner: 200_000, advanced: 750_000, pro: 2_000_000 },
    orbitRadius: 4.0,
    orbitSpeed: 0.085,
    orbitInclination: -0.7,
    initialAngle: 4.75,
    size: 0.14,
  }),
  orchestrator({
    slug: "themis",
    name: "Themis",
    role: "CLO",
    fullTitle: "Chief Legal Orchestrator",
    reportsTo: "orchestrator.sentinel",
    scope: "Legal, governance, ethics, contracts, compliance, and policy.",
    bullets: ["Legal", "Governance", "Contracts", "Policy"],
    coins: { beginner: 200_000, advanced: 750_000, pro: 2_000_000 },
    orbitRadius: 3.1,
    orbitSpeed: 0.1,
    orbitInclination: 0.9,
    initialAngle: 3.1,
    size: 0.14,
  }),
];

/* -------------------------------------------------------------------- */
/* Command plans, fragment rewards, milestones, collectibles             */
/* -------------------------------------------------------------------- */

const commandPlans: CommandPlan[] = [
  { id: "command.plan.starter", name: "Starter", priceUsd: 99.99, monthlyCoins: 500_000, description: "Start exploring Command with focused orchestrator usage." },
  { id: "command.plan.builder", name: "Builder", priceUsd: 199.99, monthlyCoins: 2_000_000, description: "Activate key orchestrators for early teams and founders." },
  { id: "command.plan.professional", name: "Professional", priceUsd: 499.99, monthlyCoins: 7_500_000, description: "Use advanced orchestrator workspaces across strategy, operations, and finance." },
  { id: "command.plan.business", name: "Business", priceUsd: 999.99, monthlyCoins: 20_000_000, description: "Run multiple orchestrator workspaces across your company." },
  { id: "command.plan.growth", name: "Growth", priceUsd: 1999.99, monthlyCoins: 50_000_000, description: "Scale AI leadership across departments and workflows." },
  { id: "command.plan.scale", name: "Scale", priceUsd: 3999.99, monthlyCoins: 125_000_000, description: "Large scale orchestrator usage for serious operators." },
  { id: "command.plan.enterprise", name: "Enterprise", priceUsd: 7999.99, monthlyCoins: 300_000_000, description: "Enterprise AI orchestration for teams, systems, and strategy." },
  { id: "command.plan.enterprise-plus", name: "Enterprise Plus", priceUsd: 14999.99, monthlyCoins: 750_000_000, description: "High capacity orchestration across many workspaces." },
  { id: "command.plan.sovereign", name: "Sovereign", priceUsd: 29999.99, monthlyCoins: 2_000_000_000, description: "Sovereign AI command capacity for elite organizations." },
  { id: "command.plan.custom", name: "Custom", priceUsd: null, monthlyCoins: null, description: "Custom, dedicated, and enterprise terms. Contact sales." },
];

/**
 * Spark pricing — Sparks are the usage currency of Vorinthex AI, and this
 * object is the single source of truth for how they are bought. The
 * pricing biome (Exchange), the /pricing page body, and llms.txt all
 * render from it; edit here, never in the routes.
 */
const sparkPricing = {
  unit: "Sparks",
  summary:
    "Everything in Vorinthex runs on Sparks. Every action you perform consumes Sparks. Every subscription simply refills your balance each month. Spend them anywhere.",
  plans: [
    { id: "spark.plan.moon", name: "Moon", priceUsd: 19.99, monthlySparks: 1_000, description: "Great for early users." },
    { id: "spark.plan.comet", name: "Comet", priceUsd: 39.99, monthlySparks: 5_000, description: "Perfect for serious users." },
    { id: "spark.plan.nova", name: "Nova", priceUsd: 99.99, monthlySparks: 25_000, description: "Highest value and On-Demand access." },
  ],
  onDemand: {
    id: "spark.on-demand",
    name: "On-Demand Sparks",
    billing: "monthly" as const,
    description: "Unlimited usage. Billed monthly. Requires Nova.",
    costTier: "Higher cost per Spark",
  },
  topUps: {
    id: "spark.top-ups",
    name: "Spark Top-Ups",
    billing: "one-time" as const,
    description:
      "Spark packs you buy once, credited the instant you need a burst.",
    costTier: "Highest cost per Spark",
    packs: [
      { id: "spark.pack.small", name: "Small", sparks: 500, priceUsd: 14.99 },
      { id: "spark.pack.medium", name: "Medium", sparks: 2_500, priceUsd: 49.99 },
      { id: "spark.pack.large", name: "Large", sparks: 10_000, priceUsd: 149.99 },
      { id: "spark.pack.xl", name: "XL", sparks: 50_000, priceUsd: 599.99 },
    ],
  },
};

const fragmentRewards: FragmentReward[] = [
  { id: "reward.early-access-candidate", threshold: 500, name: "Early Access Candidate", description: "Unlock early access eligibility for Core." },
  { id: "reward.founder-badge", threshold: 2_500, name: "Founder Badge", description: "Receive an exclusive Founder badge." },
  { id: "reward.core-discount", threshold: 10_000, name: "Core Early Access Discount", description: "Unlock early access pricing for Core." },
  { id: "reward.command-beta-priority", threshold: 25_000, name: "Command Private Beta Priority", description: "Priority access to the Command private beta." },
  { id: "reward.founder-cosmetic", threshold: 100_000, name: "Founder Cosmetic + Feature Votes", description: "Founder cosmetic and priority feature votes." },
  { id: "reward.galaxy-architect", threshold: 1_000_000, name: "Galaxy Architect Status", description: "Permanent Galaxy Architect status." },
];

const communityMilestones: CommunityMilestone[] = [
  { id: "milestone.core-early-access", threshold: 1_000_000, label: "Core enters public early access." },
  { id: "milestone.studio-visible", threshold: 5_000_000, label: "Studio planet becomes visible." },
  { id: "milestone.launch-orbit", threshold: 10_000_000, label: "Launch planet enters orbit." },
  { id: "milestone.command-beta", threshold: 25_000_000, label: "Command private beta expands." },
  { id: "milestone.new-region", threshold: 100_000_000, label: "New galaxy region discovered." },
];

/**
 * Hidden Intelligence Fragments scattered through the scene. Server routes
 * validate collects against this same config, the client is never trusted.
 */
const collectibles: CollectibleDef[] = [
  { id: "collectible.frag-belt-1", slug: "frag-belt-1", name: "Belt Fragment", type: "fragment", rarity: "common", fragments: 12, isLive: true, isCollectible: true, isDiscoverable: true, position: [8.6, 0.4, -2.8], parentEntityId: "nexus.star" },
  { id: "collectible.frag-belt-2", slug: "frag-belt-2", name: "Belt Fragment", type: "fragment", rarity: "common", fragments: 16, isLive: true, isCollectible: true, isDiscoverable: true, position: [-9.1, -0.6, 3.4], parentEntityId: "nexus.star" },
  { id: "collectible.frag-core-echo", slug: "frag-core-echo", name: "Core Echo", type: "material", rarity: "uncommon", fragments: 32, isLive: true, isCollectible: true, isDiscoverable: true, position: [4.6, 1.5, 4.4], parentEntityId: "product.core" },
  { id: "collectible.frag-command-cipher", slug: "frag-command-cipher", name: "Command Cipher", type: "blueprint", rarity: "rare", fragments: 96, isLive: true, isCollectible: true, isDiscoverable: true, position: [-6.2, 1.8, -5.6], parentEntityId: "product.command" },
  { id: "collectible.founder-relic", slug: "founder-relic", name: "Founder Relic", type: "relic", rarity: "founder", fragments: 1000, isLive: true, isCollectible: true, isDiscoverable: true, position: [12.5, -2.2, 9.8], parentEntityId: "product.launch" },
  { id: "collectible.frag-nexus-mote", slug: "frag-nexus-mote", name: "Nexus Mote", type: "fragment", rarity: "common", fragments: 8, isLive: true, isCollectible: true, isDiscoverable: true, position: [2.2, 1.9, -3.1], parentEntityId: "nexus.star" },
  { id: "collectible.frag-studio-prism", slug: "frag-studio-prism", name: "Studio Prism", type: "material", rarity: "uncommon", fragments: 40, isLive: true, isCollectible: true, isDiscoverable: true, position: [-3.4, -1.4, 9.6], parentEntityId: "product.studio" },
  { id: "collectible.frag-launch-spark", slug: "frag-launch-spark", name: "Launch Spark", type: "fragment", rarity: "common", fragments: 14, isLive: true, isCollectible: true, isDiscoverable: true, position: [11.4, 0.9, -6.8], parentEntityId: "product.launch" },
  { id: "collectible.frag-outer-sigil", slug: "frag-outer-sigil", name: "Outer Sigil", type: "blueprint", rarity: "rare", fragments: 120, isLive: true, isCollectible: true, isDiscoverable: true, position: [-14.6, 1.2, -9.4], parentEntityId: "nexus.star" },
  { id: "collectible.frag-belt-vein", slug: "frag-belt-vein", name: "Belt Vein", type: "material", rarity: "uncommon", fragments: 48, isLive: true, isCollectible: true, isDiscoverable: true, position: [16.8, -0.8, 4.2], parentEntityId: "nexus.star" },
  { id: "collectible.frag-drift-tear", slug: "frag-drift-tear", name: "Drift Tear", type: "fragment", rarity: "rare", fragments: 88, isLive: true, isCollectible: true, isDiscoverable: true, position: [0.4, -2.6, -12.8], parentEntityId: "nexus.star" },
  { id: "collectible.frag-halo-seed", slug: "frag-halo-seed", name: "Halo Seed", type: "fragment", rarity: "common", fragments: 10, isLive: true, isCollectible: true, isDiscoverable: true, position: [-7.8, 2.4, 8.9], parentEntityId: "product.studio" },
  // Interior treasures: hidden inside world biomes (isDiscoverable: false
  // keeps them out of open space — chambers place them by seed).
  { id: "collectible.geode-core-1", slug: "geode-core-1", name: "Core Geode", type: "material", rarity: "uncommon", fragments: 24, isLive: true, isCollectible: true, isDiscoverable: false, position: [0, 0, 0], parentEntityId: "product.core" },
  { id: "collectible.geode-core-2", slug: "geode-core-2", name: "Memory Vein", type: "material", rarity: "rare", fragments: 64, isLive: true, isCollectible: true, isDiscoverable: false, position: [0, 0, 0], parentEntityId: "product.core" },
  { id: "collectible.geode-command-1", slug: "geode-command-1", name: "Command Geode", type: "material", rarity: "uncommon", fragments: 28, isLive: true, isCollectible: true, isDiscoverable: false, position: [0, 0, 0], parentEntityId: "product.command" },
  { id: "collectible.geode-command-2", slug: "geode-command-2", name: "Strategy Vein", type: "material", rarity: "rare", fragments: 72, isLive: true, isCollectible: true, isDiscoverable: false, position: [0, 0, 0], parentEntityId: "product.command" },
  { id: "collectible.geode-studio-1", slug: "geode-studio-1", name: "Studio Geode", type: "material", rarity: "uncommon", fragments: 26, isLive: true, isCollectible: true, isDiscoverable: false, position: [0, 0, 0], parentEntityId: "product.studio" },
  { id: "collectible.geode-studio-2", slug: "geode-studio-2", name: "Prism Vein", type: "material", rarity: "rare", fragments: 68, isLive: true, isCollectible: true, isDiscoverable: false, position: [0, 0, 0], parentEntityId: "product.studio" },
  { id: "collectible.geode-launch-1", slug: "geode-launch-1", name: "Launch Geode", type: "material", rarity: "uncommon", fragments: 30, isLive: true, isCollectible: true, isDiscoverable: false, position: [0, 0, 0], parentEntityId: "product.launch" },
  { id: "collectible.geode-launch-2", slug: "geode-launch-2", name: "Ember Vein", type: "material", rarity: "rare", fragments: 76, isLive: true, isCollectible: true, isDiscoverable: false, position: [0, 0, 0], parentEntityId: "product.launch" },
  { id: "collectible.geode-core-3", slug: "geode-core-3", name: "Thought Shard", type: "fragment", rarity: "common", fragments: 12, isLive: true, isCollectible: true, isDiscoverable: false, position: [0, 0, 0], parentEntityId: "product.core" },
  { id: "collectible.geode-core-4", slug: "geode-core-4", name: "Grove Pearl", type: "material", rarity: "uncommon", fragments: 34, isLive: true, isCollectible: true, isDiscoverable: false, position: [0, 0, 0], parentEntityId: "product.core" },
  { id: "collectible.geode-command-3", slug: "geode-command-3", name: "Order Shard", type: "fragment", rarity: "common", fragments: 14, isLive: true, isCollectible: true, isDiscoverable: false, position: [0, 0, 0], parentEntityId: "product.command" },
  { id: "collectible.geode-command-4", slug: "geode-command-4", name: "Vault Pearl", type: "material", rarity: "uncommon", fragments: 36, isLive: true, isCollectible: true, isDiscoverable: false, position: [0, 0, 0], parentEntityId: "product.command" },
  { id: "collectible.geode-studio-3", slug: "geode-studio-3", name: "Muse Shard", type: "fragment", rarity: "common", fragments: 12, isLive: true, isCollectible: true, isDiscoverable: false, position: [0, 0, 0], parentEntityId: "product.studio" },
  { id: "collectible.geode-studio-4", slug: "geode-studio-4", name: "Spore Pearl", type: "material", rarity: "uncommon", fragments: 32, isLive: true, isCollectible: true, isDiscoverable: false, position: [0, 0, 0], parentEntityId: "product.studio" },
  { id: "collectible.geode-launch-3", slug: "geode-launch-3", name: "Ignition Shard", type: "fragment", rarity: "common", fragments: 16, isLive: true, isCollectible: true, isDiscoverable: false, position: [0, 0, 0], parentEntityId: "product.launch" },
  { id: "collectible.geode-launch-4", slug: "geode-launch-4", name: "Magma Pearl", type: "material", rarity: "uncommon", fragments: 38, isLive: true, isCollectible: true, isDiscoverable: false, position: [0, 0, 0], parentEntityId: "product.launch" },
];

/* -------------------------------------------------------------------- */
/* The singleton                                                         */
/* -------------------------------------------------------------------- */

export const VORINTHEX_GALAXY_REGISTRY = {
  brand: {
    id: "brand.vorinthex-ai",
    name: "Vorinthex AI",
    tagline: "The Nexus of Intelligence",
    logo: {
      src: "/logos/vorinthex-mark.png",
      alt: "Vorinthex AI logo",
      kind: "png" as const,
    },
  },
  nexus,
  products: { core, command, studio, launch },
  capabilities: { archive, gallery, signal, compass, ascend },
  orchestrators: Object.fromEntries(
    orchestrators.map((o) => [o.slug, o]),
  ) as Record<string, GalaxyEntity>,
  commandPlans,
  sparkPricing,
  fragmentRewards,
  communityMilestones,
  collectibles,
  /** Global fragment goal for the community counter. */
  fragmentGoal: 1_000_000,
  fragmentCounterLabel: "Intelligence Fragments",
  nexusConstructionLabel: "Nexus Construction",
};

export type GalaxyRegistry = typeof VORINTHEX_GALAXY_REGISTRY;
