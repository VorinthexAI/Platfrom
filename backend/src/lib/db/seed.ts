import { aql } from 'arangojs';
import { closeDb, db } from './client';
import { newId } from '@/lib/ids';
import { getProviderBySlug, insertProvider, updateProvider, type Provider } from './providers.node';
import { getModelBySlug, insertModel, updateModel as updatePersistedModel, type Model } from './models.node';
import { getModelActionById, getModelActionByPair, insertModelAction, modelActionSeedSchema, updateModelAction } from './model-actions.node';
import { isArangoUniqueConstraintError } from './base';
import { getModelProviderById, getModelProviderByPair, insertModelProvider, modelProviderSeedSchema, updateModelProvider, type ModelProvider } from './model-providers.node';
import { getRootOrganization, insertOrganization, updateOrganization, type Organization } from './organizations.node';
import { getUserOrganizationByOrganizationAndUser, updateUserOrganization } from './user-organization.node';
import { getUserByEmail } from './users.node';
import { getOrchestratorByName, insertOrchestrator, updateOrchestrator, type Orchestrator } from './orchestrators.node';
import { getDefaultScopeRepository, NEXUS_SCOPE_KEY } from '@/lib/ai/scopes';
import { reconcileOrganizationScopeMemberships } from '@/lib/ai/scopes/membership-invariant';
import { SEEDED_ORCHESTRATOR_SKILLS } from '@/lib/orchestrators/seeded-skills';
import { CANONICAL_ORCHESTRATOR_NAMES } from '@/lib/orchestrators/roster';
import { retireAiPersistence } from '@/db/retire-ai-persistence';
import { ACTION_DEFINITIONS } from '@/lib/ai/actions';
import { COUNTRY_CATALOG } from '@/lib/travel/country-catalog';
import { currentEmbeddingSchema, embedText } from '@/lib/embeddings';
import { createHash } from 'node:crypto';
import { ensureGeneratedDocumentFolders } from '@/lib/generated-documents/folders';

export type SeedResult = {
  collection: string;
  key: string;
  status: 'created' | 'updated';
};

export class SeedReferenceError extends Error {
  constructor(public readonly entity: string, public readonly reference: string, public readonly relation: string) {
    super(`Seed ${entity} not found for ${relation}: ${reference}`);
    this.name = 'SeedReferenceError';
  }
}

export interface AiRuntimeSeedUpserters {
  provider(seed: (typeof SEEDED_PROVIDERS)[number]): Promise<SeedResult>;
  model(seed: (typeof SEEDED_MODELS)[number]): Promise<SeedResult>;
  modelAction(seed: (typeof SEEDED_MODEL_ACTIONS)[number]): Promise<SeedResult>;
  modelProvider(seed: (typeof SEEDED_MODEL_PROVIDERS)[number]): Promise<SeedResult>;
}

const now = () => new Date().toISOString();

export const SEEDED_PROVIDERS = [
  {
    key: 'cmrl6mtn60005a1b23aushlt0',
    slug: 'openai',
    name: 'OpenAI',
    handlerKey: 'openai',
  },
  {
    key: 'cmopenrouterprovider000001',
    slug: 'openrouter',
    name: 'OpenRouter',
    handlerKey: 'openrouter',
  },
  {
    key: 'cmrl6mtn60007a1b23aushlt0',
    slug: 'anthropic',
    name: 'Anthropic',
    handlerKey: 'anthropic',
  },
  {
    key: 'cmrl6mtn60008a1b23aushlt0',
    slug: 'aws-bedrock',
    name: 'AWS Bedrock',
    handlerKey: 'aws-bedrock',
  },
  {
    key: 'cmrl6mtn60014a1b23aushlt0',
    slug: 'aws-bedrock-mantle',
    name: 'AWS Bedrock Mantle',
    handlerKey: 'aws-bedrock-mantle',
  },
  {
    key: 'cmrl6mtn60009a1b23aushlt0',
    slug: 'google-vertex',
    name: 'Google Vertex AI',
    handlerKey: 'google-vertex',
  },
  {
    key: 'cmrl6mtn60010a1b23aushlt0',
    slug: 'azure-ai-foundry',
    name: 'Azure AI Foundry',
    handlerKey: 'azure-ai-foundry',
  },
  {
    key: 'cmrl6mtn60011a1b23aushlt0',
    slug: 'xai',
    name: 'xAI',
    handlerKey: 'xai',
  },
] as const;

export const SEEDED_MODELS = [
  {
    key: 'cmgpt56lunamodel0000001',
    slug: 'openai.gpt-5.6-luna',
    name: 'OpenAI GPT-5.6 Luna',
    description: 'OpenAI general-purpose reasoning model for agent execution, analysis, and multimodal understanding.',
    supportedUseCases: 'Agent execution, reasoning, coding, tool use, classification, extraction, and visual understanding.',
    enabled: true,
  },
  {
    key: 'cmgptimage2model000000001',
    slug: 'openai.gpt-image-2',
    name: 'OpenAI GPT Image 2',
    description: 'OpenAI image generation and editing model.',
    supportedUseCases: 'Image generation, image editing, and visual asset creation.',
    enabled: true,
  },
  {
    key: 'cmgpt4ominittsmodel000001',
    slug: 'openai.gpt-4o-mini-tts',
    name: 'OpenAI GPT-4o Mini TTS',
    description: 'OpenAI speech generation model.',
    supportedUseCases: 'Narration and speech generation.',
    enabled: true,
  },
  {
    key: 'cmopenai3smallembed00001',
    slug: 'openai.text-embedding-3-small',
    name: 'OpenAI Text Embedding 3 Small',
    description: 'OpenAI embedding model at 1536 dimensions.',
    supportedUseCases: 'Retrieval-augmented generation, semantic search, vector retrieval, classification, and document similarity.',
    enabled: true,
  },
  {
    key: 'cmflux2klein4bmodel000001',
    slug: 'bfl.flux-2-klein-4b',
    name: 'Black Forest Labs FLUX.2 Klein 4B',
    description: 'Low-latency image generation model routed through OpenRouter.',
    supportedUseCases: 'Fast image generation and visual asset creation.',
    enabled: true,
  },
  {
    key: 'cmgrokimagequalitymodel001',
    slug: 'xai.grok-imagine-image-quality',
    name: 'xAI Grok Imagine Image Quality',
    description: 'Quality-focused image generation model routed through OpenRouter.',
    supportedUseCases: 'Image generation and visual asset creation.',
    enabled: true,
  },
  {
    key: 'cmgemini25flashlitemodel1',
    slug: 'google.gemini-2.5-flash-lite',
    name: 'Google Gemini 2.5 Flash Lite',
    description: 'Fast, cost-efficient Google text generation model routed through OpenRouter.',
    supportedUseCases: 'Destination guides, image briefs, summarization, and structured text generation.',
    enabled: true,
  },
] as const;

const SEEDED_MODEL_SLUGS = new Set<string>(SEEDED_MODELS.map(({ slug }) => slug));

/** Persist only runtime bindings backed by the retained model catalog. */
export const seededModelActionKey = (actionSlug: string, modelSlug: string) => `c${createHash('sha256').update(`${actionSlug}\0${modelSlug}`).digest('hex').slice(0, 24)}`;

export const SEEDED_MODEL_ACTIONS = ACTION_DEFINITIONS.flatMap((definition) =>
  definition.models.filter(({ model }) => SEEDED_MODEL_SLUGS.has(model)).map((binding) => ({
    key: seededModelActionKey(definition.id, binding.model),
    modelSlug: binding.model,
    actionSlug: definition.id,
    priority: binding.priority,
    enabled: true,
  })),
);

export const SEEDED_MODEL_PROVIDERS = [
  {
    key: 'cmgpt56lunaroute0000001',
    modelSlug: 'openai.gpt-5.6-luna',
    providerSlug: 'openai',
    providerModelId: 'gpt-5.6-luna',
    enabled: true,
  },
  {
    key: 'cmgptimage2route000000001',
    modelSlug: 'openai.gpt-image-2',
    providerSlug: 'openai',
    providerModelId: 'gpt-image-2',
    enabled: true,
  },
  {
    key: 'cmgpt4ominittsroute000001',
    modelSlug: 'openai.gpt-4o-mini-tts',
    providerSlug: 'openai',
    providerModelId: 'gpt-4o-mini-tts',
    enabled: true,
  },
  {
    key: 'cmopenai3smallembedroute1',
    modelSlug: 'openai.text-embedding-3-small',
    providerSlug: 'openai',
    providerModelId: 'text-embedding-3-small',
    enabled: true,
  },
  {
    key: 'cmflux2klein4broute000001',
    modelSlug: 'bfl.flux-2-klein-4b',
    providerSlug: 'openrouter',
    providerModelId: 'black-forest-labs/flux.2-klein-4b',
    enabled: true,
  },
  {
    key: 'cmgrokimagequalityroute001',
    modelSlug: 'xai.grok-imagine-image-quality',
    providerSlug: 'openrouter',
    providerModelId: 'x-ai/grok-imagine-image-quality',
    enabled: true,
  },
  {
    key: 'cmgemini25flashliteroute1',
    modelSlug: 'google.gemini-2.5-flash-lite',
    providerSlug: 'openrouter',
    providerModelId: 'google/gemini-2.5-flash-lite',
    enabled: true,
  },
] as const;

export const SEEDED_ORGANIZATION = {
  name: 'Vorinthex AI',
  is_root: true,
  metadata: {},
};

export { NEXUS_SCOPE_KEY };

export const SEEDED_SCOPES = [
  {
    key: NEXUS_SCOPE_KEY,
    slug: 'nexus',
    name: 'Nexus',
    summary: 'Vorinthex is an AI native platform that unifies intelligence, knowledge and execution into a single system that helps people and organizations think, build and achieve more with artificial intelligence.',
    description: `Vorinthex is an AI native platform designed to become the intelligence layer for modern work and life. Its purpose is to bring together reasoning, knowledge, memory and execution into a single unified system that grows more capable over time.

Instead of treating artificial intelligence as a collection of isolated chatbots and disconnected tools, Vorinthex organizes intelligence into specialized Orchestrators that collaborate to solve complex problems across engineering, marketing, finance, operations, creativity and many other domains. Every Orchestrator focuses on a specific area while sharing context through a common knowledge graph, allowing the platform to understand how information, decisions and work are connected.

Every interaction contributes to a persistent understanding of the user, the organization and the projects being built. Rather than starting from an empty conversation each time, Vorinthex continuously builds knowledge, preserves context and improves future reasoning through accumulated experience. This allows intelligence to compound instead of being reset with every new task.

The platform is designed to coordinate both human and artificial intelligence. Large objectives can be transformed into structured plans, broken into smaller tasks and executed through specialized agents that work together toward a shared goal. As work progresses, new knowledge is captured, summarized and connected back into the system, creating an intelligence network that becomes increasingly valuable over time.

Vorinthex is built to remain flexible as artificial intelligence continues to evolve. Users can connect their preferred models, providers and services while interacting through a single consistent experience. This allows the platform to adopt new capabilities without requiring people to change how they work.

The long term vision is to create a new way of interacting with software. Rather than opening dozens of separate applications for different tasks, people will work alongside an intelligent system that understands their objectives, coordinates specialized capabilities and continuously learns from every action. Vorinthex represents a future where intelligence is persistent, collaborative and deeply integrated into everything people create, allowing individuals and organizations to focus less on software and more on achieving meaningful outcomes.`,
    position: 1,
    level: 1,
    parentKey: null,
  },
  {
    key: 'cmrnlzf640001qc7kazsr96k5',
    slug: 'core',
    name: 'Core',
    summary: 'Your personal AI brain for memory, knowledge, reasoning, and everyday productivity across work and life.',
    description: 'Your personal AI brain for memory, knowledge, reasoning, and everyday productivity across work and life.',
    position: 1,
    level: 2,
    parentKey: NEXUS_SCOPE_KEY,
  },
  {
    key: 'cmrnlzf640004qc7kdvj99uva',
    slug: 'command',
    name: 'Command',
    summary: 'A command center with 20 AI executive orchestrators, from Atlas to Vulcan, for every function of the company.',
    description: 'A command center with 20 AI executive orchestrators, led by Atlas and spanning operations, intelligence, growth, product, finance, security, and more, leading the work while you lead the vision.',
    position: 2,
    level: 2,
    parentKey: NEXUS_SCOPE_KEY,
  },
  {
    key: 'cmrnlzf640005qc7kefvra0bn',
    slug: 'hq',
    name: 'HQ',
    summary: 'The organization workspace for communication, collaboration, planning, and coordinated work.',
    description: 'HQ is the shared operating space for an organization. Bring conversations, plans, projects, decisions, knowledge, and coordinated work into one focused headquarters.',
    position: 3,
    level: 2,
    parentKey: NEXUS_SCOPE_KEY,
  },
  {
    key: 'cmrnlzf640007qc7kd6a2g0o8',
    slug: 'pilot',
    name: 'Pilot',
    summary: 'A learning platform for the AI era.',
    description: 'Pilot is the Vorinthex learning platform for the AI era, built to help people develop the understanding and practical fluency they need to move forward.',
    position: 4,
    level: 2,
    parentKey: NEXUS_SCOPE_KEY,
  },
  {
    key: 'cmrnlzf640003qc7k4n8zesyz',
    slug: 'studio',
    name: 'Studio',
    summary: 'A unified studio for chat, image, video, music, voice, code, documents, and research.',
    description: 'Every leading AI model in one interface, chat, image, video, music, voice, code, documents, and research in a single creative workspace.',
    position: 5,
    level: 2,
    parentKey: NEXUS_SCOPE_KEY,
  },
  {
    key: 'cmrnlzf640002qc7kfp2qelhq',
    slug: 'launch',
    name: 'Launch',
    summary: 'A lightweight platform to create agents, automations, workflows, and deploy them everywhere.',
    description: 'A lightweight platform to create agents, automations, and workflows, then deploy them everywhere your work happens.',
    position: 6,
    level: 2,
    parentKey: NEXUS_SCOPE_KEY,
  },
  {
    key: 'cmrnlzf640006qc7kfjl23jc3',
    slug: 'replica',
    name: 'Replica',
    summary: 'A sandbox for experiencing a product before you connect.',
    description: 'Replica is the Vorinthex sandbox for experiencing a product before you connect, giving you a clear place to explore what it can do first.',
    position: 7,
    level: 2,
    parentKey: NEXUS_SCOPE_KEY,
  },
  { key: 'cmrnlzf650001qc7k4p5zem5w', slug: 'archive', name: 'Archive', summary: 'Capture notes, ideas, research, labels, folders, semantic search, and knowledge graph connections.', description: 'Archive lets you capture, organize, semantically search, and connect your notes through folders, labels, backlinks, and graph traversal.', position: 1, level: 3, parentKey: 'cmrnlzf640001qc7kazsr96k5' },
  { key: 'cmrnlzf650002qc7k4p5zem5w', slug: 'gallery', name: 'Gallery', summary: 'A smart image and memory library with albums, clusters, sharing links, QR invites, and AI powered discovery.', description: 'Gallery organizes memories and images into smart albums, clusters, shared links, QR invites, and AI powered discovery.', position: 2, level: 3, parentKey: 'cmrnlzf640001qc7kazsr96k5' },
  { key: 'cmrnlzf650003qc7k4p5zem5w', slug: 'signal', name: 'Signal', summary: 'An AI inbox guard across email and messages that filters noise, prioritizes what matters, and can reply in your tone.', description: 'Signal is an AI inbox guard that filters noise across connected inboxes, prioritizes important messages, and can reply in your tone when approved.', position: 3, level: 3, parentKey: 'cmrnlzf640001qc7kazsr96k5' },
  { key: 'cmrnlzf650004qc7k4p5zem5w', slug: 'compass', name: 'Compass', summary: 'An interactive 3D globe for exploring countries and viewing available cities.', description: 'Compass turns country discovery into a clear map of available destination cities.', position: 4, level: 3, parentKey: 'cmrnlzf640001qc7kazsr96k5' },
  { key: 'cmrnlzf650005qc7k4p5zem5w', slug: 'ascend', name: 'Ascend', summary: 'A personal AI coach for mental goals, habits, health, routines, finance, and custom learning books.', description: 'Ascend is a personal AI coach for goals, habits, health, routines, finance, and custom books and learning journeys.', position: 5, level: 3, parentKey: 'cmrnlzf640001qc7kazsr96k5' },
  { key: 'cmrnlzf650026qc7k4p5zem5w', slug: 'chorus', name: 'Chorus', summary: 'Communication intelligence for messaging, channels, threads, and real time collaboration between people and AI.', description: 'Chorus is an AI native communication workspace for messaging, channels, threads, announcements, direct messages, and real time collaboration. It understands conversations semantically so people can search by meaning, summarize discussions, identify action items, translate messages, and recover important context without manual organization. Chorus supports reactions, mentions, attachments, presence, and persistent conversation history.', position: 6, level: 3, parentKey: 'cmrnlzf640001qc7kazsr96k5' },
  { key: 'cmrnlzf650027qc7k4p5zem5w', slug: 'cadence', name: 'Cadence', summary: 'Temporal intelligence for calendars, schedules, meetings, availability, reminders, and recurring events.', description: 'Cadence is an intelligent planning system for calendars, events, meetings, reminders, availability, deadlines, recurring schedules, reservations, and planning windows. It understands relationships between commitments, priorities, people, and resources, then helps resolve conflicts, suggest useful times, prepare agendas, protect focus time, and maintain clear follow through. Cadence treats time as structured information rather than a simple chronological list.', position: 7, level: 3, parentKey: 'cmrnlzf640001qc7kazsr96k5' },
  { key: 'cmrnlzf650029qc7k4p5zem5w', slug: 'prism', name: 'Prism', summary: 'Meeting and presence intelligence for voice, video, screen sharing, recordings, transcription, and collaborative sessions.', description: 'Prism is a real time meeting workspace for voice calls, video sessions, screen sharing, recordings, live transcription, captions, and AI assistance. It understands conversations as they happen, making discussions searchable and turning decisions, follow up items, and important context into durable knowledge. Prism preserves the full meeting experience through participants, recordings, transcripts, summaries, and collaborative session metadata.', position: 8, level: 3, parentKey: 'cmrnlzf640001qc7kazsr96k5' },
  { key: 'cmrnlzf650006qc7k4p5zem5w', slug: 'atlas', name: 'Atlas', summary: 'Vision, leadership, direction, executive strategy, and company wide decisions.', description: 'Vision, leadership, direction, executive strategy, and company wide decisions.', position: 1, level: 3, parentKey: 'cmrnlzf640004qc7kdvj99uva' },
  { key: 'cmrnlzf650007qc7k4p5zem5w', slug: 'hermes', name: 'Hermes', summary: 'Operations, execution, efficiency, systems, process, and delivery.', description: 'Operations, execution, efficiency, systems, process, and delivery.', position: 2, level: 3, parentKey: 'cmrnlzf640004qc7kdvj99uva' },
  { key: 'cmrnlzf650008qc7k4p5zem5w', slug: 'metis', name: 'Metis', summary: 'Intelligence, knowledge, data, documents, RAG, internal brain, and integrations.', description: 'Intelligence, knowledge, data, documents, RAG, internal brain, and integrations.', position: 3, level: 3, parentKey: 'cmrnlzf640004qc7kdvj99uva' },
  { key: 'cmrnlzf650009qc7k4p5zem5w', slug: 'phoenix', name: 'Phoenix', summary: 'Growth, market insight, acquisition, activation, retention, and durable commercial value.', description: 'Growth, market insight, acquisition, activation, retention, and durable commercial value.', position: 4, level: 3, parentKey: 'cmrnlzf640004qc7kdvj99uva' },
  { key: 'cmrnlzf650010qc7k4p5zem5w', slug: 'apollo', name: 'Apollo', summary: 'Strategy, foresight, growth, market direction, and long range planning.', description: 'Strategy, foresight, growth, market direction, and long range planning.', position: 5, level: 3, parentKey: 'cmrnlzf640004qc7kdvj99uva' },
  { key: 'cmrnlzf650011qc7k4p5zem5w', slug: 'iris', name: 'Iris', summary: 'Communication, brand, voice, PR, messaging, and internal and external communications.', description: 'Communication, brand, voice, PR, messaging, and internal and external communications.', position: 6, level: 3, parentKey: 'cmrnlzf640004qc7kdvj99uva' },
  { key: 'cmrnlzf650012qc7k4p5zem5w', slug: 'echo', name: 'Echo', summary: 'Institutional learning, expertise reuse, durable guidance, knowledge discovery, and trusted organizational memory.', description: 'Institutional learning, expertise reuse, durable guidance, knowledge discovery, and trusted organizational memory.', position: 7, level: 3, parentKey: 'cmrnlzf640004qc7kdvj99uva' },
  { key: 'cmrnlzf650013qc7k4p5zem5w', slug: 'matrix', name: 'Matrix', summary: 'Data governance, lineage, ownership, quality, definitions, and decision ready data assets.', description: 'Data governance, lineage, ownership, quality, definitions, and decision ready data assets.', position: 8, level: 3, parentKey: 'cmrnlzf640004qc7kdvj99uva' },
  { key: 'cmrnlzf650014qc7k4p5zem5w', slug: 'harmony', name: 'Harmony', summary: 'People systems, talent, culture, organizational structure, capability, and sustained high quality work.', description: 'People systems, talent, culture, organizational structure, capability, and sustained high quality work.', position: 9, level: 3, parentKey: 'cmrnlzf640004qc7kdvj99uva' },
  { key: 'cmrnlzf650015qc7k4p5zem5w', slug: 'ledger', name: 'Ledger', summary: 'Finance, capital, budgets, cash flow, forecasting, and financial risk.', description: 'Finance, capital, budgets, cash flow, forecasting, and financial risk.', position: 10, level: 3, parentKey: 'cmrnlzf640004qc7kdvj99uva' },
  { key: 'cmrnlzf650016qc7k4p5zem5w', slug: 'orbit', name: 'Orbit', summary: 'Marketing, growth, demand, branding, content, campaigns, SEO, and social.', description: 'Marketing, growth, demand, branding, content, campaigns, SEO, and social.', position: 11, level: 3, parentKey: 'cmrnlzf640004qc7kdvj99uva' },
  { key: 'cmrnlzf650017qc7k4p5zem5w', slug: 'mercury', name: 'Mercury', summary: 'Revenue, analytics, MRR, forecasting, sales patterns, churn, and retention.', description: 'Revenue, analytics, MRR, forecasting, sales patterns, churn, and retention.', position: 12, level: 3, parentKey: 'cmrnlzf640004qc7kdvj99uva' },
  { key: 'cmrnlzf650018qc7k4p5zem5w', slug: 'sentinel', name: 'Sentinel', summary: 'Security, risk, protection, compliance, privacy, and trust.', description: 'Security, risk, protection, compliance, privacy, and trust.', position: 13, level: 3, parentKey: 'cmrnlzf640004qc7kdvj99uva' },
  { key: 'cmrnlzf650019qc7k4p5zem5w', slug: 'athena', name: 'Athena', summary: 'Product, experience, innovation, roadmap, value, and users.', description: 'Product, experience, innovation, roadmap, value, and users.', position: 14, level: 3, parentKey: 'cmrnlzf640004qc7kdvj99uva' },
  { key: 'cmrnlzf650020qc7k4p5zem5w', slug: 'forge', name: 'Forge', summary: 'Technology, architecture, engineering, infrastructure, and AI.', description: 'Technology, architecture, engineering, infrastructure, and AI.', position: 15, level: 3, parentKey: 'cmrnlzf640004qc7kdvj99uva' },
  { key: 'cmrnlzf650021qc7k4p5zem5w', slug: 'aura', name: 'Aura', summary: 'Customer and product experience, journey coherence, friction reduction, confidence, and meaningful touchpoints.', description: 'Customer and product experience, journey coherence, friction reduction, confidence, and meaningful touchpoints.', position: 16, level: 3, parentKey: 'cmrnlzf640004qc7kdvj99uva' },
  { key: 'cmrnlzf650022qc7k4p5zem5w', slug: 'pillar', name: 'Pillar', summary: 'Quality systems, prevention, measurable delivery standards, early defect detection, and durable improvement.', description: 'Quality systems, prevention, measurable delivery standards, early defect detection, and durable improvement.', position: 17, level: 3, parentKey: 'cmrnlzf640004qc7kdvj99uva' },
  { key: 'cmrnlzf650023qc7k4p5zem5w', slug: 'helios', name: 'Helios', summary: 'Accountable AI capability, use cases, evaluation, safety, human ownership, and durable advantage.', description: 'Accountable AI capability, use cases, evaluation, safety, human ownership, and durable advantage.', position: 18, level: 3, parentKey: 'cmrnlzf640004qc7kdvj99uva' },
  { key: 'cmrnlzf650024qc7k4p5zem5w', slug: 'vulcan', name: 'Vulcan', summary: 'Observable, safe, maintainable automation that removes repeatable operational drag.', description: 'Observable, safe, maintainable automation that removes repeatable operational drag.', position: 19, level: 3, parentKey: 'cmrnlzf640004qc7kdvj99uva' },
  { key: 'cmrnlzf650025qc7k4p5zem5w', slug: 'themis', name: 'Themis', summary: 'Legal, governance, ethics, contracts, compliance, and policy.', description: 'Legal, governance, ethics, contracts, compliance, and policy.', position: 20, level: 3, parentKey: 'cmrnlzf640004qc7kdvj99uva' },
] as const;

type SeededOrchestratorSource = {
  name: string;
  role: string;
  skill: string;
};

export const SEEDED_ORCHESTRATOR_SOURCES: SeededOrchestratorSource[] = [
  ['Atlas', 'CEO'], ['Metis', 'CIO'], ['Echo', 'CKO'], ['Matrix', 'CDO'], ['Hermes', 'COO'],
  ['Harmony', 'CHRO'], ['Phoenix', 'CGO'], ['Iris', 'CCO'], ['Orbit', 'CMO'], ['Apollo', 'CSO'],
  ['Athena', 'CPO'], ['Forge', 'CTO'], ['Aura', 'CXO'], ['Pillar', 'CQO'], ['Helios', 'CAIO'],
  ['Vulcan', 'CAO'], ['Ledger', 'CFO'], ['Mercury', 'CRO'], ['Sentinel', 'CISO'], ['Themis', 'CLO'],
].map(([name, role]) => ({
  name,
  role,
  skill: SEEDED_ORCHESTRATOR_SKILLS[name as keyof typeof SEEDED_ORCHESTRATOR_SKILLS],
}));

const SEEDED_FOUNDER_ORCHESTRATORS = {
  'oscar@vorinthex.com': 'Atlas',
  'josef@vorinthex.com': 'Orbit',
  'frank@vorinthex.com': 'Mercury',
  'vincent@vorinthex.com': 'Iris',
  'anton@vorinthex.com': 'Apollo',
} as const;

async function upsertSeedProvider(seed: (typeof SEEDED_PROVIDERS)[number]): Promise<SeedResult> {
  const existing = await getProviderBySlug(seed.slug);
  if (!existing) {
    await insertProvider(seed);
    return { collection: 'providers', key: seed.key, status: 'created' };
  }

  const patch: Partial<Omit<Provider, 'key' | 'embedding'>> = {
    name: seed.name,
    handlerKey: seed.handlerKey,
  };
  await updateProvider(existing.key, patch);
  return { collection: 'providers', key: existing.key, status: 'updated' };
}

async function upsertSeedModel(seed: (typeof SEEDED_MODELS)[number]): Promise<SeedResult> {
  const existing = await getModelBySlug(seed.slug);
  if (!existing) {
    await insertModel(seed);
    return { collection: 'models', key: seed.key, status: 'created' };
  }

  const patch: Partial<Omit<Model, 'key' | 'embedding'>> = {
    name: seed.name,
    description: seed.description,
    supportedUseCases: seed.supportedUseCases,
    enabled: seed.enabled,
  };
  await updatePersistedModel(existing.key, patch);
  return { collection: 'models', key: existing.key, status: 'updated' };
}

async function upsertSeedModelAction(seed: (typeof SEEDED_MODEL_ACTIONS)[number]): Promise<SeedResult> {
  const parsed = modelActionSeedSchema.parse(seed);
  const model = await getModelBySlug(parsed.modelSlug);
  if (!model) throw new SeedReferenceError('model', parsed.modelSlug, 'modelAction');

  const existing = await getModelActionByPair(model.key, parsed.actionSlug);
  if (!existing) {
    const seededKeyOwner = await getModelActionById(parsed.key);
    let key = seededKeyOwner ? newId() : parsed.key;
    try {
      await insertModelAction({
        key,
        modelKey: model.key,
        actionSlug: parsed.actionSlug,
        priority: parsed.priority,
        enabled: parsed.enabled,
      });
    } catch (error) {
      if (!isArangoUniqueConstraintError(error)) throw error;
      key = newId();
      await insertModelAction({
        key,
        modelKey: model.key,
        actionSlug: parsed.actionSlug,
        priority: parsed.priority,
        enabled: parsed.enabled,
      });
    }
    return { collection: 'modelActions', key, status: 'created' };
  }

  await updateModelAction(existing.key, { priority: parsed.priority, enabled: parsed.enabled });
  return { collection: 'modelActions', key: existing.key, status: 'updated' };
}

async function upsertSeedModelProvider(seed: (typeof SEEDED_MODEL_PROVIDERS)[number]): Promise<SeedResult> {
  const parsed = modelProviderSeedSchema.parse(seed);
  const model = await getModelBySlug(parsed.modelSlug);
  if (!model) throw new SeedReferenceError('model', parsed.modelSlug, 'modelProvider');
  const provider = await getProviderBySlug(parsed.providerSlug);
  if (!provider) throw new SeedReferenceError('provider', parsed.providerSlug, 'modelProvider');

  const existing = await getModelProviderByPair(model.key, provider.key);
  if (!existing) {
    const keyOwner = await getModelProviderById(parsed.key);
    const key = keyOwner ? newId() : parsed.key;
    await insertModelProvider({
      key,
      modelKey: model.key,
      providerKey: provider.key,
      providerModelId: parsed.providerModelId,
      enabled: parsed.enabled,
    });
    return { collection: 'modelProviders', key, status: 'created' };
  }

  await updateModelProvider(existing.key, {
    providerModelId: parsed.providerModelId,
    enabled: parsed.enabled,
  });
  return { collection: 'modelProviders', key: existing.key, status: 'updated' };
}

async function upsertSeedOrganization(seed: typeof SEEDED_ORGANIZATION): Promise<SeedResult> {
  const existing = await getRootOrganization();
  if (!existing) {
    const key = newId();
    await insertOrganization({
      key,
      name: seed.name,
      is_root: seed.is_root,
      metadata: seed.metadata,
      createdAt: now(),
      updatedAt: now(),
    });
    return { collection: 'organizations', key, status: 'created' };
  }

  const patch: Partial<Omit<Organization, 'key' | 'embedding'>> = {
    name: seed.name,
    is_root: seed.is_root,
    metadata: seed.metadata,
    updatedAt: now(),
  };
  await updateOrganization(existing.key, patch);
  return { collection: 'organizations', key: existing.key, status: 'updated' };
}

async function upsertSeedOrchestrator(seed: (typeof SEEDED_ORCHESTRATOR_SOURCES)[number]): Promise<SeedResult> {
  const existing = await getOrchestratorByName(seed.name);
  if (!existing) {
    const key = newId();
    await insertOrchestrator({
      key,
      name: seed.name,
      role: seed.role,
      skill: seed.skill,
      createdAt: now(),
      updatedAt: now(),
    });
    return { collection: 'orchestrators', key, status: 'created' };
  }

  const patch: Partial<Omit<Orchestrator, 'key' | 'embedding'>> = {
    role: seed.role,
    skill: seed.skill,
    updatedAt: now(),
  };
  await updateOrchestrator(existing.key, patch);
  return { collection: 'orchestrators', key: existing.key, status: 'updated' };
}

async function assignSeededFounderOrchestrators(rootOrganizationKey: string): Promise<SeedResult[]> {
  const results: SeedResult[] = [];
  for (const [email, orchestratorName] of Object.entries(SEEDED_FOUNDER_ORCHESTRATORS)) {
    const [user, orchestrator] = await Promise.all([
      getUserByEmail(email),
      getOrchestratorByName(orchestratorName),
    ]);
    if (!user || !orchestrator) continue;
    const membership = await getUserOrganizationByOrganizationAndUser(rootOrganizationKey, user.key);
    if (!membership || membership.orchestratorKey === orchestrator.key) continue;
    await updateUserOrganization(membership.key, { orchestratorKey: orchestrator.key, updatedAt: now() });
    results.push({ collection: 'userOrganizations', key: membership.key, status: 'updated' });
  }
  return results;
}

export async function seedAiRuntimeNodes(upserters: AiRuntimeSeedUpserters = {
  provider: upsertSeedProvider,
  model: upsertSeedModel,
  modelAction: upsertSeedModelAction,
  modelProvider: upsertSeedModelProvider,
}): Promise<SeedResult[]> {
  const results: SeedResult[] = [];
  for (const seed of SEEDED_PROVIDERS) results.push(await upserters.provider(seed));
  for (const seed of SEEDED_MODELS) results.push(await upserters.model(seed));
  for (const seed of SEEDED_MODEL_ACTIONS) results.push(await upserters.modelAction(seed));
  for (const seed of SEEDED_MODEL_PROVIDERS) results.push(await upserters.modelProvider(seed));
  return results;
}

export async function seedCoreDbNodes(): Promise<SeedResult[]> {
  await retireAiPersistence(db);
  const results = await seedAiRuntimeNodes();
  for (const country of COUNTRY_CATALOG) {
    const semanticHash = createHash('sha256').update(country.name).digest('hex');
    const currentCursor = await db.query<{ key: string; semanticVersion?: number; semanticHash?: string }>('FOR country IN countries FILTER country.countryCode == @countryCode LIMIT 1 RETURN { key: country._key, semanticVersion: country.semanticVersion, semanticHash: country.semanticHash }', { countryCode: country.countryCode });
    const current = await currentCursor.next();
    if (current?.semanticVersion === 1 && current.semanticHash === semanticHash) {
      await db.query('UPDATE @key WITH { name: @name, latitude: @latitude, longitude: @longitude } IN countries', { key: current.key, name: country.name, latitude: country.latitude, longitude: country.longitude });
      results.push({ collection: 'countries', key: current.key, status: 'updated' });
      continue;
    }
    const embedding = currentEmbeddingSchema.parse(await embedText({ text: country.name }));
    const cursor = await db.query(`UPSERT { countryCode: @countryCode } INSERT @country UPDATE { name: @name, latitude: @latitude, longitude: @longitude, embedding: @embedding, semanticVersion: 1, semanticHash: @semanticHash } IN countries RETURN NEW._key`, { countryCode: country.countryCode, name: country.name, latitude: country.latitude, longitude: country.longitude, semanticHash, country: { _key: country.key, ...country, embedding, semanticVersion: 1, semanticHash }, embedding });
    results.push({ collection: 'countries', key: String(await cursor.next()), status: current ? 'updated' : 'created' });
  }

  results.push(await upsertSeedOrganization(SEEDED_ORGANIZATION));
  const rootOrganization = await getRootOrganization();
  if (!rootOrganization) throw new SeedReferenceError('organization', 'root', 'core seed');
  await db.query(aql`
    LET hasHq = LENGTH((
      FOR existing IN ${db.collection('scopes')}
        FILTER existing.organizationKey == ${rootOrganization.key} AND existing.slug == ${'hq'}
        RETURN 1
    ))
    FOR scope IN ${db.collection('scopes')}
      FILTER scope.organizationKey == ${rootOrganization.key}
      FILTER scope.slug == ${'head-quarters'}
      FILTER hasHq == 0
      UPDATE scope WITH { slug: 'hq' } IN ${db.collection('scopes')}
  `);
  const scopes = getDefaultScopeRepository();
  const organizationScopes = [...await scopes.listScopes(rootOrganization.key)];
  const scopesBySlug = new Map(organizationScopes.map((scope) => [scope.slug, scope]));
  const actualKeysBySeedKey = new Map<string, string>();
  for (const seed of SEEDED_SCOPES) {
    // Legacy scope rows can be omitted from the organization listing while
    // still occupying their deterministic seed key. Reuse that row instead
    // of attempting a duplicate insert during deployment.
    let existing = scopesBySlug.get(seed.slug) ?? await scopes.getScopeByKey(seed.key);
    if (existing) {
      if (existing.name !== seed.name || existing.summary !== seed.summary || existing.description !== seed.description || existing.position !== seed.position || existing.level !== seed.level) {
        existing = await scopes.updateScope(existing.key, { name: seed.name, summary: seed.summary, description: seed.description, position: seed.position, level: seed.level });
        scopesBySlug.set(existing.slug, existing);
        const index = organizationScopes.findIndex((scope) => scope.key === existing!.key);
        if (index >= 0) organizationScopes[index] = existing;
        results.push({ collection: 'scopes', key: existing.key, status: 'updated' });
      }
      actualKeysBySeedKey.set(seed.key, existing.key);
      continue;
    }
    const scope = await scopes.createScope({
      key: seed.key,
      organizationKey: rootOrganization.key,
      slug: seed.slug,
      name: seed.name,
      summary: seed.summary,
      description: seed.description,
      position: seed.position,
      level: seed.level,
    });
    organizationScopes.push(scope);
    scopesBySlug.set(scope.slug, scope);
    actualKeysBySeedKey.set(seed.key, scope.key);
    results.push({ collection: 'scopes', key: scope.key, status: 'created' });
  }
  for (const scope of organizationScopes) await ensureGeneratedDocumentFolders(db, scope.key);

  const relationsByChild = new Map<string, { parentKey: string; childKey: string }>();
  for (const scope of organizationScopes) {
    for (const relation of await scopes.listChildRelations(scope.key)) {
      relationsByChild.set(relation.childKey, relation);
    }
  }
  for (const seed of SEEDED_SCOPES.filter((scope) => scope.parentKey)) {
    const childKey = actualKeysBySeedKey.get(seed.key) ?? seed.key;
    const child = await scopes.getScopeByKey(childKey);
    if (!child) throw new SeedReferenceError('scope', seed.slug, 'scopeScopes');
    const parentKey = actualKeysBySeedKey.get(seed.parentKey!) ?? seed.parentKey!;
    const parent = await scopes.getScopeByKey(parentKey);
    if (!parent) throw new SeedReferenceError('scope', seed.parentKey!, 'scopeScopes');
    const existingRelation = relationsByChild.get(child.key);
    if (existingRelation?.parentKey === parent.key) continue;
    if (existingRelation) {
      await scopes.removeScopeRelation(existingRelation.parentKey, child.key);
    }
    const relation = await scopes.addScopeRelation(parent.key, child.key);
    relationsByChild.set(child.key, relation);
    results.push({ collection: 'scopeScopes', key: relation.key, status: 'created' });
  }

  const membershipReconciliation = await reconcileOrganizationScopeMemberships(rootOrganization.key);
  results.push(...membershipReconciliation.created.map(({ key }) => ({ collection: 'scopeMembers', key, status: 'created' as const })));

  for (const orchestrator of SEEDED_ORCHESTRATOR_SOURCES) {
    results.push(await upsertSeedOrchestrator(orchestrator));
  }
  const hqScope = await scopes.getScopeByKey(actualKeysBySeedKey.get('cmrnlzf640005qc7kefvra0bn') ?? 'cmrnlzf640005qc7kefvra0bn');
  if (!hqScope) throw new SeedReferenceError('scope', 'hq', 'general channel');
  const generalCursor = await db.query<{ key: string }>(`
    UPSERT { organizationKey: @organizationKey, kind: "group", name: "general" }
      INSERT { _key: @key, organizationKey: @organizationKey, scopeKey: @scopeKey, kind: "group", name: "general", description: "Organization-wide conversation", position: 0, createdAt: @now, updatedAt: @now, embedding: [] }
      UPDATE { scopeKey: @scopeKey, archivedAt: null, updatedAt: @now } IN channels OPTIONS { keepNull: false }
      RETURN { key: NEW._key }
  `, { key: newId(), organizationKey: rootOrganization.key, scopeKey: hqScope.key, now: now() });
  const general = (await generalCursor.next())!;
  results.push({ collection: 'channels', key: general.key, status: 'updated' });
  const orchestratorCursor = await db.query<{ key: string }>('FOR orchestrator IN orchestrators FILTER orchestrator.name IN @names SORT orchestrator.name ASC, orchestrator._key ASC RETURN { key: orchestrator._key }', { names: CANONICAL_ORCHESTRATOR_NAMES });
  for (const orchestrator of await orchestratorCursor.all()) {
    const participantKey = newId();
    const participantCursor = await db.query<{ key: string }>(`
      UPSERT { channelKey: @channelKey, orchestratorKey: @orchestratorKey }
        INSERT { _key: @key, scopeKey: @scopeKey, channelKey: @channelKey, orchestratorKey: @orchestratorKey, joinedAt: @now, createdAt: @now, updatedAt: @now, embedding: [] }
        UPDATE { scopeKey: @scopeKey, updatedAt: @now } IN channelParticipants
        RETURN { key: NEW._key }
    `, { key: participantKey, scopeKey: hqScope.key, channelKey: general.key, orchestratorKey: orchestrator.key, now: now() });
    const participant = (await participantCursor.next())!;
    results.push({ collection: 'channelParticipants', key: participant.key, status: participant.key === participantKey ? 'created' : 'updated' });
  }
  results.push(...await assignSeededFounderOrchestrators(rootOrganization.key));

  return results;
}

if (import.meta.main) {
  try {
    const results = await seedCoreDbNodes();
    console.table(results);
  } finally {
    await closeDb();
  }
}
