import { join } from 'node:path';
import { closeDb } from './client';
import { newId } from '@/lib/ids';
import { getActionById, getActionBySlug, insertAction, updateAction, type Action } from './actions.node';
import { getProviderBySlug, insertProvider, updateProvider, type Provider } from './providers.node';
import { getModelBySlug, insertModel, updateModel, type Model } from './models.node';
import { getModelActionByPair, insertModelAction, modelActionSeedSchema, updateModelAction } from './model-actions.node';
import { getModelProviderByPair, insertModelProvider, modelProviderSeedSchema, updateModelProvider } from './model-providers.node';
import { getToolBySlug, insertTool, updateTool, type Tool } from './tools.node';
import { getToolActionByPair, insertToolAction, toolActionSeedSchema, updateToolAction } from './tool-actions.node';
import { getRootOrganization, insertOrganization, updateOrganization, type Organization } from './organizations.node';
import { getProductByProductId, insertProduct, updateProduct, type Product } from './products.node';
import { getVoiceByProviderModelVoice, insertVoice, updateVoice, type Voice } from './voices.node';
import { getOrchestratorByName, insertOrchestrator, updateOrchestrator, type Orchestrator } from './orchestrators.node';
import { getDefaultScopeRepository, NEXUS_SCOPE_KEY } from '@/lib/ai/scopes';
import { getDefaultOrganizationProviderRepository } from '@/lib/ai/organization-providers';
import { seedGenesis, GENESIS_SCOPE_SLUG } from '@/lib/ai/genesis/seed';
import { seedBeacon } from '@/lib/ai/beacon/seed';

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
  action(seed: (typeof SEEDED_ACTIONS)[number]): Promise<SeedResult>;
  provider(seed: (typeof SEEDED_PROVIDERS)[number]): Promise<SeedResult>;
  model(seed: (typeof SEEDED_MODELS)[number]): Promise<SeedResult>;
  modelAction(seed: (typeof SEEDED_MODEL_ACTIONS)[number]): Promise<SeedResult>;
  modelProvider(seed: (typeof SEEDED_MODEL_PROVIDERS)[number]): Promise<SeedResult>;
  tool(seed: (typeof SEEDED_TOOLS)[number]): Promise<SeedResult>;
  toolAction(seed: (typeof SEEDED_TOOL_ACTIONS)[number]): Promise<SeedResult>;
}

const now = () => new Date().toISOString();

export const SEEDED_ACTIONS = [
  {
    key: 'cm9action01vorinthexseed',
    slug: 'core.ask',
    name: 'Ask',
    description: 'Answer a natural-language request within the active agent role and scope.',
    objective: 'Provide a clear and useful response while respecting skill, guardrails, tools, permissions, and schema.',
    inputDescription: 'A question, instruction, or conversational message with optional context and runtime metadata.',
    outputDescription: 'A schema-valid answer with mandatory metadata containing accepted or rejected status, a reason of at most ten words, and a self-assessed score.',
    handlerKey: 'core.ask',
    enabled: true,
  },
  {
    key: 'cm9action02vorinthexseed',
    slug: 'core.reason',
    name: 'Reason',
    description: 'Perform deliberate analysis, planning, comparison, evaluation, decomposition, or decision support.',
    objective: 'Produce a structured conclusion or plan from available context, constraints, evidence, alternatives, and success criteria.',
    inputDescription: 'A problem, objective, decision, planning request, evaluation target, or structured facts and constraints.',
    outputDescription: 'A validated recommendation, plan, comparison, decision, or evaluation with mandatory metadata.',
    handlerKey: 'core.reason',
    enabled: true,
  },
  {
    key: 'cmgenesisactioncreateagent001',
    slug: 'agent.create',
    name: 'Create Agent',
    description: 'Validates and transactionally creates or reuses an agent, its required skills, skill relations, and allowed tool relations.',
    objective: 'Persist a complete validated agent architecture from a Genesis creation manifest.',
    inputDescription: 'A validated Genesis agent creation manifest containing an agent operation, skill operations, agent skill relations, and existing tools to attach.',
    outputDescription: 'The persisted or reused agent, created skills, linking nodes, provenance artifacts, and validation result.',
    handlerKey: 'agent.create',
    enabled: true,
  },
  {
    key: 'cmartifactreadaction00000001',
    slug: 'artifact.read',
    name: 'Read Artifact',
    description: 'Lazily reads one authorized artifact through its registered reverse-context resolver.',
    objective: 'Return the full safe context projection for one permitted knowledge block.',
    inputDescription: 'Organization, scope, agent, node type, and node key identifiers.',
    outputDescription: 'A normalized Knowledge Block without raw database fields or storage metadata.',
    handlerKey: 'artifact.read',
    enabled: true,
  },
  {
    key: 'cm9action03vorinthexseed',
    slug: 'web.search',
    name: 'Web Search',
    description: 'Search the public web for relevant pages, documents, sources, products, entities, facts, or current information.',
    objective: 'Retrieve focused web results for grounded evidence or downstream use.',
    inputDescription: 'A search query with optional recency, domain, language, region, result count, and content-type constraints.',
    outputDescription: 'Normalized search results with titles, snippets, source references, and mandatory metadata.',
    handlerKey: 'web.search',
    enabled: true,
  },
  {
    key: 'cm9action04vorinthexseed',
    slug: 'web.deep-research',
    name: 'Deep Research',
    description: 'Conduct iterative multi-source web research with synthesis, comparison, contradiction handling, and evidence-based conclusions.',
    objective: 'Produce a comprehensive and defensible research result with uncertainty and gaps made explicit.',
    inputDescription: 'A research question or investigation target with optional source, geography, date, depth, and output constraints.',
    outputDescription: 'A structured research report with findings, sources, caveats, unresolved questions, and mandatory metadata.',
    handlerKey: 'web.deep-research',
    enabled: true,
  },
  {
    key: 'cm9action05vorinthexseed',
    slug: 'image.generate',
    name: 'Generate Image',
    description: 'Create one or more new images from text and optional reference assets or brand direction.',
    objective: 'Generate image output matching the requested subject, composition, style, format, dimensions, and intended use.',
    inputDescription: 'A detailed image prompt with optional references, aspect ratio, dimensions, quantity, transparency, style, and negative constraints.',
    outputDescription: 'Generated image artifacts with normalized media metadata and mandatory metadata.',
    handlerKey: 'image.generate',
    enabled: true,
  },
  {
    key: 'cm9action06vorinthexseed',
    slug: 'image.edit',
    name: 'Edit Image',
    description: 'Modify an existing image by adding, removing, replacing, restyling, retouching, enhancing, extending, or correcting content.',
    objective: 'Produce an edited image that preserves required source characteristics while applying requested changes accurately.',
    inputDescription: 'Source image references, editing instructions, optional masks, regions, dimensions, preservation constraints, and format.',
    outputDescription: 'Edited image artifacts with normalized media metadata and mandatory metadata.',
    handlerKey: 'image.edit',
    enabled: true,
  },
  {
    key: 'cm9action07vorinthexseed',
    slug: 'image.create-slideshow',
    name: 'Create Slideshow',
    description: 'Create a coherent multi-slide visual slideshow from a topic, objective, source material, brand context, and audience.',
    objective: 'Produce a complete slideshow with logical narrative, consistent design, suitable pacing, and platform-aware content.',
    inputDescription: 'A topic, goal, source text, audience, platform, slide count, aspect ratio, brand rules, tone, and call to action.',
    outputDescription: 'An ordered slideshow with slide copy, asset references, layout metadata, narrative flow, and mandatory metadata.',
    handlerKey: 'image.create-slideshow',
    enabled: true,
  },
  {
    key: 'cm9action08vorinthexseed',
    slug: 'video.generate',
    name: 'Generate Video',
    description: 'Create a new video from text instructions and optional visual, audio, character, brand, or reference inputs.',
    objective: 'Generate a video matching the requested subject, motion, timing, composition, style, duration, and publishing context.',
    inputDescription: 'A video prompt with optional references, aspect ratio, duration, resolution, frame rate, audio, camera, motion, and style constraints.',
    outputDescription: 'A generated video artifact with normalized metadata, duration, dimensions, previews when available, and mandatory metadata.',
    handlerKey: 'video.generate',
    enabled: true,
  },
  {
    key: 'cm9action09vorinthexseed',
    slug: 'video.edit',
    name: 'Edit Video',
    description: 'Modify an existing video by changing content, timing, pacing, visuals, audio, captions, transitions, framing, or production elements.',
    objective: 'Produce an edited video that preserves required source material while applying requested changes coherently.',
    inputDescription: 'A source video, editing instructions, optional time ranges, replacement assets, crop, subtitle, audio, brand, and output settings.',
    outputDescription: 'An edited video artifact with normalized metadata, an edit summary, previews when available, and mandatory metadata.',
    handlerKey: 'video.edit',
    enabled: true,
  },
  {
    key: 'cm9action10vorinthexseed',
    slug: 'video.extend',
    name: 'Extend Video',
    description: 'Continue an existing video beyond its current ending while preserving continuity, identity, motion, style, and scene logic.',
    objective: 'Generate a seamless continuation satisfying the requested direction and duration.',
    inputDescription: 'A source video, extension duration, continuation prompt, continuity constraints, optional end-frame guidance, audio, and format.',
    outputDescription: 'An extended video artifact with normalized metadata, extension duration, continuity notes when available, and mandatory metadata.',
    handlerKey: 'video.extend',
    enabled: true,
  },
  {
    key: 'cm9action11vorinthexseed',
    slug: 'video.analyze',
    name: 'Analyze Video',
    description: 'Inspect video content including scenes, objects, people, actions, speech, timing, quality, structure, or compliance.',
    objective: 'Return a grounded structured analysis of the supplied video according to requested dimensions.',
    inputDescription: 'A video reference with analysis objectives, optional time ranges, categories, questions, quality criteria, and detail level.',
    outputDescription: 'A structured analysis with observations, timestamps, findings, issues, summaries, and mandatory metadata.',
    handlerKey: 'video.analyze',
    enabled: true,
  },
  {
    key: 'cm9action12vorinthexseed',
    slug: 'video.create-variation',
    name: 'Create Video Variation',
    description: 'Create a new variation of an existing video while preserving selected characteristics and changing specified attributes.',
    objective: 'Produce an alternative version for testing, localization, platform adaptation, targeting, or stylistic exploration.',
    inputDescription: 'A source video, variation brief, preserved and changed attributes, target audience or platform, duration, ratio, and output settings.',
    outputDescription: 'A new video variation with normalized metadata, a concise description of changes, and mandatory metadata.',
    handlerKey: 'video.create-variation',
    enabled: true,
  },
  {
    key: 'cm9action13vorinthexseed',
    slug: 'audio.transcribe',
    name: 'Transcribe Audio',
    description: 'Convert spoken audio into text with optional speakers, timestamps, languages, sections, or confidence information.',
    objective: 'Produce an accurate, readable, and structurally useful transcription.',
    inputDescription: 'An audio or video reference with optional language, diarization, timestamps, formatting, vocabulary, and segmentation preferences.',
    outputDescription: 'A structured transcript with text, optional speakers, timestamps, language, segments, and mandatory metadata.',
    handlerKey: 'audio.transcribe',
    enabled: true,
  },
  {
    key: 'cm9action14vorinthexseed',
    slug: 'audio.generate-speech',
    name: 'Generate Speech',
    description: 'Generate spoken audio from text using a requested voice, tone, pacing, language, pronunciation, and delivery style.',
    objective: 'Produce natural and intelligible speech matching the requested vocal direction.',
    inputDescription: 'Text with optional voice identifier, language, tone, pace, emphasis, pronunciation hints, emotion, format, and quality settings.',
    outputDescription: 'A generated speech artifact with normalized metadata, duration when available, and mandatory metadata.',
    handlerKey: 'audio.generate-speech',
    enabled: true,
  },
  {
    key: 'cm9action15vorinthexseed',
    slug: 'audio.analyze',
    name: 'Analyze Audio',
    description: 'Inspect audio for speech, sound events, music, speaker characteristics, sentiment, quality, structure, or compliance.',
    objective: 'Return a grounded structured interpretation according to requested analytical criteria.',
    inputDescription: 'An audio reference with an analysis objective, optional time ranges, target properties, categories, quality criteria, and detail level.',
    outputDescription: 'A structured analysis with observations, timestamps, detected properties, issues, summaries, and mandatory metadata.',
    handlerKey: 'audio.analyze',
    enabled: true,
  },
  {
    key: 'cm9action16vorinthexseed',
    slug: 'audio.generate-music',
    name: 'Generate Music',
    description: 'Create original music from a text brief and optional structural, instrumental, stylistic, emotional, or temporal constraints.',
    objective: 'Generate coherent music matching the requested mood, genre, instrumentation, structure, duration, energy, and use.',
    inputDescription: 'A music brief with optional genre, mood, instruments, tempo, duration, structure, vocals, references, loop requirement, and format.',
    outputDescription: 'A generated music artifact with normalized metadata, duration, structural notes when available, and mandatory metadata.',
    handlerKey: 'audio.generate-music',
    enabled: true,
  },
] as const;

export const SEEDED_PROVIDERS = [
  {
    key: 'cmrl6mtn60005a1b23aushlt0',
    slug: 'openai',
    name: 'OpenAI',
    description: 'Provides language, reasoning, image, audio, and multimodal AI models through OpenAI APIs.',
    supportedUseCases: 'Conversational AI, reasoning, structured outputs, image generation, audio generation, transcription, and multimodal workflows.',
    handlerKey: 'openai',
    enabled: true,
  },
] as const;

export const SEEDED_MODELS = [
  {
    key: 'cmrl6mtn60001a1b2hmukitfl',
    slug: 'openai.gpt-5.4-mini',
    name: 'GPT-5.4 Mini',
    description: 'A balanced language model optimized for high-quality reasoning, conversations, structured outputs, and agent execution.',
    supportedUseCases: 'Conversational AI, reasoning, planning, structured outputs, coding, analysis, research, and general-purpose agent workloads.',
    enabled: true,
  },
  {
    key: 'cmrl6mtn60002a1b2ixo6nudr',
    slug: 'openai.gpt-5.4-nano',
    name: 'GPT-5.4 Nano',
    description: 'A lightweight language model optimized for fast execution, low latency, and inexpensive agent operations.',
    supportedUseCases: 'Classification, routing, validation, metadata generation, lightweight reasoning, structured outputs, and low-cost agent workflows.',
    enabled: true,
  },
] as const;

export const SEEDED_MODEL_ACTIONS = [
  {
    key: 'cmrl7b6gc0001e1c5az7x8wqf',
    modelSlug: 'openai.gpt-5.4-nano',
    actionSlug: 'core.ask',
    priority: 100,
    enabled: true,
  },
  {
    key: 'cmrl7b6gc0002e1c5b8m9ytkl',
    modelSlug: 'openai.gpt-5.4-mini',
    actionSlug: 'core.reason',
    priority: 100,
    enabled: true,
  },
] as const;

export const SEEDED_MODEL_PROVIDERS = [
  {
    key: 'cmrl6mtn60003a1b248h6bnwj',
    modelSlug: 'openai.gpt-5.4-mini',
    providerSlug: 'openai',
    providerModelId: 'gpt-5.4-mini',
    enabled: true,
  },
  {
    key: 'cmrl6mtn60004a1b22r2z407l',
    modelSlug: 'openai.gpt-5.4-nano',
    providerSlug: 'openai',
    providerModelId: 'gpt-5.4-nano',
    enabled: true,
  },
] as const;

export const SEEDED_TOOLS = [
  {
    key: 'cmrnc3nfh00003o7k20dedfh7',
    slug: 'ask.answer',
    name: 'Ask',
    description: 'Answer the user over the current message history. Granting this tool is what gives an agent a conversational surface at all.',
    scopeKey: null,
    enabled: true,
  },
  {
    key: 'cmrnc3nfh00013o7kgv66e9mv',
    slug: 'reason.solve',
    name: 'Solve',
    description: 'Work through a hard problem step by step before answering.',
    scopeKey: null,
    enabled: true,
  },
  {
    key: 'cmgenesistoolcreateagent0001',
    slug: 'agent.create',
    name: 'Create Agent',
    description: 'Creates or reuses a complete agent architecture from a validated Genesis manifest.',
    scopeKey: null,
    enabled: true,
  },
  {
    key: 'cmartifactreadtool0000000001',
    slug: 'artifact.read',
    name: 'Read Artifact',
    description: 'Lazily load an authorized artifact through its registered context resolver.',
    scopeKey: null,
    enabled: true,
  },
  {
    key: 'cmrnc3nfh00023o7kg2pr2xns',
    slug: 'image.create',
    name: 'Create Image',
    description: 'Generate a new image from a text prompt.',
    scopeKey: null,
    enabled: true,
  },
  {
    key: 'cmrnc3nfh00033o7k5rq7ams2',
    slug: 'audio.transcribe-file',
    name: 'Transcribe Audio',
    description: 'Convert speech in an uploaded audio file into text.',
    scopeKey: null,
    enabled: true,
  },
  {
    key: 'cmrnc3nfh00043o7k17vy6jtg',
    slug: 'speech.narrate',
    name: 'Narrate',
    description: 'Synthesize spoken audio from text.',
    scopeKey: null,
    enabled: true,
  },
] as const;

export const SEEDED_TOOL_ACTIONS = [
  { key: 'cmrnc3nfh00053o7k3hfm3a82', toolSlug: 'ask.answer', actionSlug: 'core.ask', priority: 100, enabled: true },
  { key: 'cmrnc3nfh00063o7keg8h70ut', toolSlug: 'reason.solve', actionSlug: 'core.reason', priority: 100, enabled: true },
  { key: 'cmgenesistoolactioncreate001', toolSlug: 'agent.create', actionSlug: 'agent.create', priority: 100, enabled: true },
  { key: 'cmartifactreadtoolaction0001', toolSlug: 'artifact.read', actionSlug: 'artifact.read', priority: 100, enabled: true },
  { key: 'cmrnc3nfh00073o7kdi1aee17', toolSlug: 'image.create', actionSlug: 'image.generate', priority: 100, enabled: true },
  { key: 'cmrnc3nfh00083o7k3rz39zwp', toolSlug: 'audio.transcribe-file', actionSlug: 'audio.transcribe', priority: 100, enabled: true },
  { key: 'cmrnc3nfh00093o7kfijm2vjk', toolSlug: 'speech.narrate', actionSlug: 'audio.generate-speech', priority: 100, enabled: true },
] as const;

export const SEEDED_PRODUCTS = [
  {
    productId: 'private.beta.access',
    name: 'Private beta',
    type: 'subscription' as const,
    priceCents: 79900,
    billingPeriod: 'month',
    gracePeriod: 7,
  },
  {
    productId: 'founder.access',
    name: 'Founder',
    type: 'subscription' as const,
    priceCents: 199900,
    billingPeriod: 'month',
    gracePeriod: 7,
  },
  {
    productId: 'enterprise.access',
    name: 'Enterprise',
    type: 'subscription' as const,
    priceCents: 599900,
    billingPeriod: 'month',
    gracePeriod: 7,
  },
  {
    productId: 'private.beta.access.ticket',
    name: 'Private beta ticket',
    type: 'one_time' as const,
    priceCents: 9900,
    billingPeriod: null,
    gracePeriod: null,
  },
];

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
    summary: 'Vorinthex is building an AI-native platform that empowers people and organizations to think, create, automate, and collaborate with intelligent systems, transforming AI from isolated tools into a trusted foundation for future work.',
    description: `Vorinthex is an AI-native technology company building the foundation for the next generation of intelligent work. Our mission is to help individuals, teams, and organizations seamlessly integrate artificial intelligence into their everyday operations, enabling them to work smarter, move faster, and make better decisions in an increasingly complex world.

We believe that AI represents a technological shift comparable to the arrival of the internet, cloud computing, and smartphones. Over the coming decade, every organization will need to become AI-native, embedding intelligence into its workflows, processes, and decision-making rather than treating AI as a standalone tool. Businesses that successfully embrace this transition will gain significant advantages in productivity, innovation, and adaptability, while those that do not risk falling behind.

Vorinthex exists to accelerate this transformation.

Rather than building isolated AI applications, we are creating a unified intelligence platform where people and artificial intelligence work together as one system. Our platform is designed to understand context, retain knowledge, support collaboration, automate repetitive work, and assist with increasingly complex tasks across every part of an organization. The goal is not simply to answer questions, but to help users think, plan, execute, and continuously improve.

At the core of our philosophy is the belief that AI should augment human capability rather than replace it. The most valuable intelligence combines human judgment, creativity, and experience with the speed, scale, and analytical power of modern AI. By keeping humans in control while allowing intelligent systems to handle routine, repetitive, and data-intensive work, organizations can unlock new levels of efficiency without sacrificing oversight or accountability.

As AI capabilities continue to evolve, flexibility becomes increasingly important. The technology landscape changes rapidly, with new models, providers, and innovations emerging every year. Vorinthex is therefore designed as a future-ready platform capable of adapting alongside the broader AI ecosystem, allowing organizations to benefit from new advances without constantly rebuilding their infrastructure.

Trust is equally fundamental. Organizations require confidence that their AI systems operate securely, respect permissions, and protect sensitive information. Vorinthex is built with governance, transparency, and controlled access as foundational principles, ensuring that intelligent systems can operate responsibly within real organizational structures while remaining aligned with business objectives.

Our long-term vision extends beyond individual productivity. We believe every organization will eventually operate with an intelligent digital layer capable of understanding its knowledge, supporting its people, coordinating work, and continuously improving how the business functions. As AI becomes an essential part of everyday work, the distinction between traditional software and intelligent systems will gradually disappear.

Vorinthex is building the infrastructure for that future: a platform where intelligence becomes a natural extension of every person, every team, and every organization, helping them become truly AI-native and prepared for the next era of technology.`,
    position: 1,
    parentKey: null,
  },
  {
    key: 'cmrnlzf640001qc7kazsr96k5',
    slug: 'core',
    name: 'Core',
    summary: 'Your personal AI brain for memory, knowledge, reasoning, and everyday productivity across work and life.',
    description: 'Your personal AI brain for memory, knowledge, reasoning, and everyday productivity across work and life.',
    position: 2,
    parentKey: NEXUS_SCOPE_KEY,
  },
  {
    key: 'cmrnlzf640002qc7kfp2qelhq',
    slug: 'launch',
    name: 'Launch',
    summary: 'Build, automate, deploy, and manage intelligent workflows, agents, and business processes from one unified workspace.',
    description: 'Build, automate, deploy, and manage intelligent workflows, agents, and business processes from one unified workspace.',
    position: 2,
    parentKey: NEXUS_SCOPE_KEY,
  },
  {
    key: 'cmrnlzf640003qc7k4n8zesyz',
    slug: 'studio',
    name: 'Studio',
    summary: 'Create websites, apps, documents, images, videos, music, and code with AI powered creative and development tools.',
    description: 'Create websites, apps, documents, images, videos, music, and code with AI powered creative and development tools.',
    position: 2,
    parentKey: NEXUS_SCOPE_KEY,
  },
  {
    key: 'cmrnlzf640004qc7kdvj99uva',
    slug: 'command',
    name: 'Command',
    summary: 'Manage AI executive teams and orchestrators that help lead strategy, operations, growth, finance, technology, and security.',
    description: 'Manage AI executive teams and orchestrators that help lead strategy, operations, growth, finance, technology, and security.',
    position: 2,
    parentKey: NEXUS_SCOPE_KEY,
  },
  {
    key: 'cmrnlzf640005qc7kefvra0bn',
    slug: 'head-quarters',
    name: 'Head Quarters',
    summary: 'Collaborate across teams, projects, files, calendars, meetings, and communication in one centralized workspace.',
    description: 'Collaborate across teams, projects, files, calendars, meetings, and communication in one centralized workspace.',
    position: 2,
    parentKey: NEXUS_SCOPE_KEY,
  },
  {
    key: 'cmrnlzf640006qc7kfjl23jc3',
    slug: 'replica',
    name: 'Replica',
    summary: 'Explore interactive demonstrations of every Vorinthex capability using realistic sample data before deploying your own.',
    description: 'Explore interactive demonstrations of every Vorinthex capability using realistic sample data before deploying your own.',
    position: 2,
    parentKey: NEXUS_SCOPE_KEY,
  },
  {
    key: 'cmrnlzf640007qc7kd6a2g0o8',
    slug: 'pilot',
    name: 'Pilot',
    summary: 'Your conversational AI assistant that helps you navigate, operate, and get the most out of the entire Vorinthex platform.',
    description: 'Your conversational AI assistant that helps you navigate, operate, and get the most out of the entire Vorinthex platform.',
    position: 2,
    parentKey: NEXUS_SCOPE_KEY,
  },
] as const;

// The Command orchestrator roster: one per scripts/orchestrators/<slug>-<role>
// directory. `voice` here must match a (provider, model, voice) already in
// SEEDED_VOICES below (derived from this list), and `dir` locates that
// orchestrator's SKILL.md.
const SEEDED_ORCHESTRATOR_SOURCES = [
  { dir: 'atlas-ceo', name: 'Atlas', role: 'CEO', provider: 'openrouter', model: 'hexgrad/kokoro-82m', voice: 'am_onyx' },
  { dir: 'apollo-cso', name: 'Apollo', role: 'CSO', provider: 'openrouter', model: 'hexgrad/kokoro-82m', voice: 'am_michael' },
  { dir: 'athena-cpo', name: 'Athena', role: 'CPO', provider: 'openrouter', model: 'hexgrad/kokoro-82m', voice: 'af_kore' },
  { dir: 'forge-cto', name: 'Forge', role: 'CTO', provider: 'openrouter', model: 'hexgrad/kokoro-82m', voice: 'am_fenrir' },
  { dir: 'hermes-coo', name: 'Hermes', role: 'COO', provider: 'openrouter', model: 'hexgrad/kokoro-82m', voice: 'bm_daniel' },
  { dir: 'iris-cco', name: 'Iris', role: 'CCO', provider: 'openrouter', model: 'hexgrad/kokoro-82m', voice: 'af_aoede' },
  { dir: 'ledger-cfo', name: 'Ledger', role: 'CFO', provider: 'openrouter', model: 'hexgrad/kokoro-82m', voice: 'bm_george' },
  { dir: 'mercury-cro', name: 'Mercury', role: 'CRO', provider: 'openrouter', model: 'hexgrad/kokoro-82m', voice: 'am_echo' },
  { dir: 'metis-cio', name: 'Metis', role: 'CIO', provider: 'openrouter', model: 'hexgrad/kokoro-82m', voice: 'bf_emma' },
  { dir: 'orbit-cmo', name: 'Orbit', role: 'CMO', provider: 'openrouter', model: 'hexgrad/kokoro-82m', voice: 'af_nova' },
  { dir: 'sentinel-ciso', name: 'Sentinel', role: 'CISO', provider: 'openrouter', model: 'hexgrad/kokoro-82m', voice: 'am_adam' },
  { dir: 'themis-clo', name: 'Themis', role: 'CLO', provider: 'openrouter', model: 'hexgrad/kokoro-82m', voice: 'bf_isabella' },
];

// Sourced from scripts/orchestrators/*/message.metadata.json — every Kokoro
// voice already used for a generated Command orchestrator greeting, labeled
// with that orchestrator's own name (derived from SEEDED_ORCHESTRATOR_SOURCES
// above so the two never drift apart), plus the premium Gemini TTS voice used
// for launch-asset voiceovers — not tied to any one orchestrator, so it gets
// the brand's own label instead.
export const SEEDED_VOICES = [
  ...SEEDED_ORCHESTRATOR_SOURCES.map((orchestrator) => ({
    provider: orchestrator.provider,
    model: orchestrator.model,
    modelLabel: 'Kokoro 82M',
    voice: orchestrator.voice,
    label: orchestrator.name,
    language: 'en',
    format: 'mp3',
  })),
  {
    provider: 'openrouter',
    model: 'google/gemini-3.1-flash-tts-preview',
    modelLabel: 'Gemini 3.1 Flash TTS Preview',
    voice: 'Charon',
    label: 'Brand Primary',
    language: 'en',
    format: 'mp3',
  },
];

// backend/src/lib/db -> repo root, then into the checked-in orchestrator
// source directory (present on a full checkout, e.g. the CI deploy job's
// runner, regardless of this script's own working directory).
const ORCHESTRATORS_SOURCE_DIR = join(import.meta.dir, '../../../../scripts/orchestrators');

function loadOrchestratorSkill(dir: string): Promise<string> {
  return Bun.file(join(ORCHESTRATORS_SOURCE_DIR, dir, 'SKILL.md')).text();
}

async function upsertSeedAction(seed: (typeof SEEDED_ACTIONS)[number]): Promise<SeedResult> {
  const existing = await getActionById(seed.key);
  if (!existing) {
    await insertAction(seed);
    return { collection: 'actions', key: seed.key, status: 'created' };
  }

  const patch: Partial<Omit<Action, 'key' | 'embedding'>> = {
    slug: seed.slug,
    name: seed.name,
    description: seed.description,
    objective: seed.objective,
    inputDescription: seed.inputDescription,
    outputDescription: seed.outputDescription,
    handlerKey: seed.handlerKey,
    enabled: seed.enabled,
  };
  await updateAction(existing.key, patch);
  return { collection: 'actions', key: existing.key, status: 'updated' };
}

async function upsertSeedProvider(seed: (typeof SEEDED_PROVIDERS)[number]): Promise<SeedResult> {
  const existing = await getProviderBySlug(seed.slug);
  if (!existing) {
    await insertProvider(seed);
    return { collection: 'providers', key: seed.key, status: 'created' };
  }

  const patch: Partial<Omit<Provider, 'key' | 'embedding'>> = {
    name: seed.name,
    description: seed.description,
    supportedUseCases: seed.supportedUseCases,
    handlerKey: seed.handlerKey,
    enabled: seed.enabled,
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
  await updateModel(existing.key, patch);
  return { collection: 'models', key: existing.key, status: 'updated' };
}

async function upsertSeedModelAction(seed: (typeof SEEDED_MODEL_ACTIONS)[number]): Promise<SeedResult> {
  const parsed = modelActionSeedSchema.parse(seed);
  const model = await getModelBySlug(parsed.modelSlug);
  if (!model) throw new SeedReferenceError('model', parsed.modelSlug, 'modelAction');
  const action = await getActionBySlug(parsed.actionSlug);
  if (!action) throw new SeedReferenceError('action', parsed.actionSlug, 'modelAction');

  const existing = await getModelActionByPair(model.key, action.key);
  if (!existing) {
    await insertModelAction({
      key: parsed.key,
      modelKey: model.key,
      actionKey: action.key,
      priority: parsed.priority,
      enabled: parsed.enabled,
    });
    return { collection: 'modelActions', key: parsed.key, status: 'created' };
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
    await insertModelProvider({
      key: parsed.key,
      modelKey: model.key,
      providerKey: provider.key,
      providerModelId: parsed.providerModelId,
      enabled: parsed.enabled,
    });
    return { collection: 'modelProviders', key: parsed.key, status: 'created' };
  }

  await updateModelProvider(existing.key, {
    providerModelId: parsed.providerModelId,
    enabled: parsed.enabled,
  });
  return { collection: 'modelProviders', key: existing.key, status: 'updated' };
}

async function upsertSeedTool(seed: (typeof SEEDED_TOOLS)[number]): Promise<SeedResult> {
  const existing = await getToolBySlug(seed.slug);
  if (!existing) {
    await insertTool(seed);
    return { collection: 'tools', key: seed.key, status: 'created' };
  }

  const patch: Partial<Omit<Tool, 'key' | 'embedding'>> = {
    name: seed.name,
    description: seed.description,
    scopeKey: seed.scopeKey,
    enabled: seed.enabled,
  };
  await updateTool(existing.key, patch);
  return { collection: 'tools', key: existing.key, status: 'updated' };
}

async function upsertSeedToolAction(seed: (typeof SEEDED_TOOL_ACTIONS)[number]): Promise<SeedResult> {
  const parsed = toolActionSeedSchema.parse(seed);
  const tool = await getToolBySlug(parsed.toolSlug);
  if (!tool) throw new SeedReferenceError('tool', parsed.toolSlug, 'toolAction');
  const action = await getActionBySlug(parsed.actionSlug);
  if (!action) throw new SeedReferenceError('action', parsed.actionSlug, 'toolAction');

  const existing = await getToolActionByPair(tool.key, action.key);
  if (!existing) {
    await insertToolAction({
      key: parsed.key,
      toolKey: tool.key,
      actionKey: action.key,
      priority: parsed.priority,
      enabled: parsed.enabled,
    });
    return { collection: 'toolActions', key: parsed.key, status: 'created' };
  }

  await updateToolAction(existing.key, { priority: parsed.priority, enabled: parsed.enabled });
  return { collection: 'toolActions', key: existing.key, status: 'updated' };
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

async function upsertSeedProduct(seed: (typeof SEEDED_PRODUCTS)[number]): Promise<SeedResult> {
  const existing = await getProductByProductId(seed.productId);
  if (!existing) {
    const key = newId();
    await insertProduct({
      ...seed,
      key,
      polarProductId: null,
      createdAt: now(),
      updatedAt: now(),
    });
    return { collection: 'products', key, status: 'created' };
  }

  const patch: Partial<Omit<Product, 'key' | 'embedding'>> = {
    productId: seed.productId,
    name: seed.name,
    type: seed.type,
    priceCents: seed.priceCents,
    billingPeriod: seed.billingPeriod,
    gracePeriod: seed.gracePeriod,
    updatedAt: now(),
  };
  await updateProduct(existing.key, patch);
  return { collection: 'products', key: existing.key, status: 'updated' };
}

async function upsertSeedVoice(seed: (typeof SEEDED_VOICES)[number]): Promise<SeedResult> {
  const existing = await getVoiceByProviderModelVoice(seed.provider, seed.model, seed.voice);
  if (!existing) {
    const key = newId();
    await insertVoice({
      ...seed,
      key,
      createdAt: now(),
      updatedAt: now(),
    });
    return { collection: 'voices', key, status: 'created' };
  }

  const patch: Partial<Omit<Voice, 'key' | 'embedding'>> = {
    modelLabel: seed.modelLabel,
    label: seed.label,
    language: seed.language,
    format: seed.format,
    updatedAt: now(),
  };
  await updateVoice(existing.key, patch);
  return { collection: 'voices', key: existing.key, status: 'updated' };
}

async function upsertSeedOrchestrator(seed: (typeof SEEDED_ORCHESTRATOR_SOURCES)[number]): Promise<SeedResult> {
  const voice = await getVoiceByProviderModelVoice(seed.provider, seed.model, seed.voice);
  if (!voice) {
    throw new Error(`Seed voice not found for orchestrator "${seed.name}": ${seed.provider}/${seed.model}/${seed.voice}`);
  }
  const skill = await loadOrchestratorSkill(seed.dir);

  const existing = await getOrchestratorByName(seed.name);
  if (!existing) {
    const key = newId();
    await insertOrchestrator({
      key,
      name: seed.name,
      role: seed.role,
      voiceId: voice.key,
      skill,
      createdAt: now(),
      updatedAt: now(),
    });
    return { collection: 'orchestrators', key, status: 'created' };
  }

  const patch: Partial<Omit<Orchestrator, 'key' | 'embedding'>> = {
    role: seed.role,
    voiceId: voice.key,
    skill,
    updatedAt: now(),
  };
  await updateOrchestrator(existing.key, patch);
  return { collection: 'orchestrators', key: existing.key, status: 'updated' };
}

export async function seedAiRuntimeNodes(upserters: AiRuntimeSeedUpserters = {
  action: upsertSeedAction,
  provider: upsertSeedProvider,
  model: upsertSeedModel,
  modelAction: upsertSeedModelAction,
  modelProvider: upsertSeedModelProvider,
  tool: upsertSeedTool,
  toolAction: upsertSeedToolAction,
}): Promise<SeedResult[]> {
  const results: SeedResult[] = [];
  for (const seed of SEEDED_ACTIONS) results.push(await upserters.action(seed));
  for (const seed of SEEDED_PROVIDERS) results.push(await upserters.provider(seed));
  for (const seed of SEEDED_MODELS) results.push(await upserters.model(seed));
  for (const seed of SEEDED_MODEL_ACTIONS) results.push(await upserters.modelAction(seed));
  for (const seed of SEEDED_MODEL_PROVIDERS) results.push(await upserters.modelProvider(seed));
  for (const seed of SEEDED_TOOLS) results.push(await upserters.tool(seed));
  for (const seed of SEEDED_TOOL_ACTIONS) results.push(await upserters.toolAction(seed));
  return results;
}

export async function seedCoreDbNodes(): Promise<SeedResult[]> {
  const results = await seedAiRuntimeNodes();

  results.push(await upsertSeedOrganization(SEEDED_ORGANIZATION));
  const rootOrganization = await getRootOrganization();
  if (!rootOrganization) throw new SeedReferenceError('organization', 'root', 'Genesis');
  const scopes = getDefaultScopeRepository();
  const organizationScopes = [...await scopes.listScopes(rootOrganization.key)];
  const scopesBySlug = new Map(organizationScopes.map((scope) => [scope.slug, scope]));
  const actualKeysBySeedKey = new Map<string, string>();
  for (const seed of SEEDED_SCOPES) {
    let existing = scopesBySlug.get(seed.slug);
    if (existing) {
      if (existing.name !== seed.name || existing.summary !== seed.summary || existing.description !== seed.description || existing.position !== seed.position) {
        existing = await scopes.updateScope(existing.key, { name: seed.name, summary: seed.summary, description: seed.description, position: seed.position });
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
    });
    organizationScopes.push(scope);
    scopesBySlug.set(scope.slug, scope);
    actualKeysBySeedKey.set(seed.key, scope.key);
    results.push({ collection: 'scopes', key: scope.key, status: 'created' });
  }

  const nexusScope = await scopes.getScopeByKey(actualKeysBySeedKey.get(NEXUS_SCOPE_KEY) ?? NEXUS_SCOPE_KEY);
  if (!nexusScope) throw new SeedReferenceError('scope', 'nexus', 'scopeScopes');
  const relationsByChild = new Map<string, { parentKey: string; childKey: string }>();
  for (const scope of organizationScopes) {
    for (const relation of await scopes.listChildRelations(scope.key)) {
      relationsByChild.set(relation.childKey, relation);
    }
  }
  const nexusChildren = SEEDED_SCOPES.filter((scope) => scope.parentKey === NEXUS_SCOPE_KEY);
  for (const seed of nexusChildren) {
    const childKey = actualKeysBySeedKey.get(seed.key) ?? seed.key;
    const child = await scopes.getScopeByKey(childKey);
    if (!child) throw new SeedReferenceError('scope', seed.slug, 'scopeScopes');
    const existingRelation = relationsByChild.get(child.key);
    if (existingRelation?.parentKey === nexusScope.key) continue;
    if (existingRelation) {
      await scopes.removeScopeRelation(existingRelation.parentKey, child.key);
    }
    const relation = await scopes.addScopeRelation(nexusScope.key, child.key);
    relationsByChild.set(child.key, relation);
    results.push({ collection: 'scopeScopes', key: relation.key, status: 'created' });
  }

  let genesisScope = organizationScopes.find((scope) => scope.slug === GENESIS_SCOPE_SLUG);
  if (!genesisScope) {
    genesisScope = await scopes.createScope({ organizationKey: rootOrganization.key, slug: GENESIS_SCOPE_SLUG, name: 'Agent Builder', summary: 'Genesis creates validated Vorinthex agents from governed manifests.', description: 'Scope for Genesis and the creation of validated Vorinthex agents.', position: 2 });
    const rootScope = organizationScopes.find((scope) => scope.slug === 'nexus');
    if (rootScope) {
      await scopes.addScopeRelation(rootScope.key, genesisScope.key);
    }
    results.push({ collection: 'scopes', key: genesisScope.key, status: 'created' });
  }
  const openAi = await getProviderBySlug('openai');
  if (!openAi) throw new SeedReferenceError('provider', 'openai', 'Genesis');
  const organizationProviders = getDefaultOrganizationProviderRepository();
  if (!await organizationProviders.hasProvider(rootOrganization.key, openAi.key)) {
    const relation = await organizationProviders.addProvider(rootOrganization.key, openAi.key);
    results.push({ collection: 'organizationProviders', key: relation.key, status: 'created' });
  }
  const genesis = await seedGenesis(rootOrganization.key);
  results.push(
    { collection: 'skills', key: genesis.skill.key, status: 'updated' },
    { collection: 'agents', key: genesis.agent.key, status: 'updated' },
    { collection: 'agentSkills', key: genesis.agentSkill.key, status: 'updated' },
    { collection: 'agentTools', key: genesis.agentTool.key, status: 'updated' },
  );

  const beacon = await seedBeacon(rootOrganization.key);
  results.push(
    { collection: 'skills', key: beacon.skill.key, status: 'updated' },
    { collection: 'agents', key: beacon.agent.key, status: 'updated' },
    { collection: 'agentSkills', key: beacon.agentSkill.key, status: 'updated' },
    ...beacon.agentTools.map((agentTool) => ({ collection: 'agentTools', key: agentTool.key, status: 'updated' as const })),
  );

  for (const product of SEEDED_PRODUCTS) {
    results.push(await upsertSeedProduct(product));
  }

  for (const voice of SEEDED_VOICES) {
    results.push(await upsertSeedVoice(voice));
  }

  for (const orchestrator of SEEDED_ORCHESTRATOR_SOURCES) {
    results.push(await upsertSeedOrchestrator(orchestrator));
  }

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
