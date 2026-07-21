import { aql } from 'arangojs';
import { closeDb, db } from './client';
import { newId } from '@/lib/ids';
import { getActionById, getActionBySlug, insertAction, updateAction, type Action } from './actions.node';
import { getProviderBySlug, insertProvider, updateProvider, type Provider } from './providers.node';
import { getModelBySlug, insertModel, updateModel as updatePersistedModel, type Model } from './models.node';
import { getModelActionByPair, insertModelAction, modelActionSeedSchema, updateModelAction } from './model-actions.node';
import { getModelProviderByPair, insertModelProvider, modelProviderSeedSchema, updateModelProvider, type ModelProvider } from './model-providers.node';
import { getRootOrganization, insertOrganization, updateOrganization, type Organization } from './organizations.node';
import { getUserOrganizationByOrganizationAndUser, updateUserOrganization } from './user-organization.node';
import { getUserByEmail } from './users.node';
import { getProductByProductId, insertProduct, updateProduct, type Product } from './products.node';
import { getVoiceByProviderModelVoice, insertVoice, updateVoice, type Voice } from './voices.node';
import { getOrchestratorByName, insertOrchestrator, updateOrchestrator, type Orchestrator } from './orchestrators.node';
import { getDefaultScopeRepository, NEXUS_SCOPE_KEY } from '@/lib/ai/scopes';
import { SEEDED_ORCHESTRATOR_SKILLS } from '@/lib/orchestrators/seeded-skills';
import { ACTION_DEFINITIONS } from '@/lib/ai/actions';

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
}

const now = () => new Date().toISOString();

const ACCESS_DOMAIN_DEFINITIONS = [
  ['scope.member.list', 'List Scope Members', 'List direct and inherited scope members with effective roles.'],
  ['scope.member.read', 'Read Scope Members', 'Read detailed effective scope and agent access for selected members.'],
  ['scope.member.add', 'Add Scope Member', 'Add existing organization members directly to a scope.'],
  ['scope.member.role.update', 'Update Scope Member Role', 'Update direct scope roles and synchronize inherited agent access.'],
  ['scope.member.activate', 'Activate Scope Member', 'Reactivate suspended direct scope memberships.'],
  ['scope.member.suspend', 'Suspend Scope Member', 'Suspend direct scope memberships while preserving relations.'],
  ['scope.member.remove', 'Remove Scope Member', 'Remove direct scope memberships and synchronize effective access.'],
  ['scope.agent.list', 'List Scope Agents', 'List authorized agent relations in a scope.'],
  ['scope.agent.read', 'Read Scope Agents', 'Read scope-agent relation details without guessing ambiguous references.'],
  ['scope.agent.add', 'Add Scope Agent', 'Link an existing compatible agent to an active scope.'],
  ['scope.agent.move', 'Move Scope Agent', 'Move or reorder an agent relation and resynchronize inherited access.'],
  ['scope.agent.archive', 'Archive Scope Agent', 'Archive a scope-agent relation and block execution through it.'],
  ['scope.agent.restore', 'Restore Scope Agent', 'Restore an archived scope-agent relation and recalculate inherited access.'],
  ['scope.agent.remove', 'Remove Scope Agent', 'Remove an archived scope-agent relation without deleting the agent definition.'],
  ['scope.agent.access-threshold.update', 'Update Scope Agent Access Threshold', 'Change the minimum scope role receiving inherited agent access.'],
  ['agent.member.list', 'List Agent Members', 'List organization members with inherited or explicit agent access.'],
  ['agent.member.read', 'Read Agent Members', 'Explain detailed effective access for selected agent members.'],
  ['agent.member.grant', 'Grant Agent Member', 'Create explicit agent grants without changing scope or organization roles.'],
  ['agent.member.revoke', 'Revoke Agent Member', 'Remove explicit grants while preserving inherited access.'],
  ['agent.member.sync', 'Sync Agent Members', 'Idempotently recalculate inherited grants for one scope-agent relation.'],
  ['organization.provider.list', 'List Organization Providers', 'List safe provider availability and routing status without secrets.'],
  ['organization.provider.read', 'Read Organization Providers', 'Read safe provider configuration, models, actions, and routing eligibility.'],
  ['organization.provider.enable', 'Enable Organization Provider', 'Enable an allowed global provider for the active organization.'],
  ['organization.provider.disable', 'Disable Organization Provider', 'Immediately prevent new routes through an organization provider.'],
  ['organization.provider.test', 'Test Organization Provider', 'Safely test provider configuration and routing health without exposing credentials.'],
  ['organization.read', 'Read Organization', 'Read safe metadata and aggregate counts for the active organization.'],
  ['organization.update', 'Update Organization', 'Update authorized organization display metadata.'],
  ['organization.archive', 'Archive Organization', 'Archive a non-root organization and immediately block operational access.'],
  ['organization.restore', 'Restore Organization', 'Restore an archived organization without restarting schedules or jobs.'],
  ['access.organization.evaluate', 'Evaluate Organization Access', 'Return a machine-readable organization authorization decision.'],
  ['access.scope.evaluate', 'Evaluate Scope Access', 'Return a machine-readable scope authorization decision.'],
  ['access.agent.evaluate', 'Evaluate Agent Access', 'Return a machine-readable agent authorization decision.'],
  ['access.organization.explain', 'Explain Organization Access', 'Explain an organization decision produced by the shared authorization engine.'],
  ['access.scope.explain', 'Explain Scope Access', 'Explain a scope decision produced by the shared authorization engine.'],
  ['access.agent.explain', 'Explain Agent Access', 'Explain an agent decision produced by the shared authorization engine.'],
] as const;

const accessSeedKey = (kind: 'action' | 'tool' | 'link', index: number) => `cmst${kind}${String(index + 1).padStart(14, '0')}`;

const LEGACY_SEEDED_ACTIONS = [
  {
    key: 'cm9action01vorinthexseed',
    slug: 'core.chat',
    name: 'Chat',
    description: 'Answer a natural-language request within the active agent role and scope.',
    objective: 'Provide a clear and useful response while respecting skill, guardrails, tools, permissions, and schema.',
    inputDescription: 'A question, instruction, or conversational message with optional context and runtime metadata.',
    outputDescription: 'A schema-valid answer with mandatory metadata containing accepted or rejected status, a reason of at most ten words, and a self-assessed score.',
    handlerKey: 'core.chat',
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
    key: 'cmcoreembedaction00000001',
    slug: 'core.embedd',
    name: 'Embed',
    description: 'Generate a semantic vector for text using the selected embedding model.',
    objective: 'Create a normalized vector suitable for retrieval and similarity operations.',
    inputDescription: 'A nonempty text value to embed.',
    outputDescription: 'A finite embedding vector.',
    handlerKey: 'core.embedd',
    enabled: true,
  },
  {
    key: 'cmcorespeakaction00000001',
    slug: 'core.speak',
    name: 'Speak',
    description: 'Synthesize speech from text using the selected voice engine.',
    objective: 'Produce playable audio from text.',
    inputDescription: 'Text, an optional voice identifier, and mp3 or wav output format.',
    outputDescription: 'Base64-encoded audio with its MIME type.',
    handlerKey: 'core.speak',
    enabled: true,
  },
  {
    key: 'cmcoretranscribeaction0001',
    slug: 'core.transcribe',
    name: 'Transcribe',
    description: 'Transcribe an audio file using the selected speech recognition engine.',
    objective: 'Produce text from authorized audio input.',
    inputDescription: 'Base64-encoded audio, its MIME type, and an optional language code.',
    outputDescription: 'The recognized transcript text.',
    handlerKey: 'core.transcribe',
    enabled: true,
  },
  {
    key: 'cmartifactcreateaction0000001',
    slug: 'artifact.create',
    name: 'Create Artifact',
    description: 'Validates and persists a semantic graph artifact backed by authorized live node and query bindings.',
    objective: 'Create a reusable spatial artifact definition in the active scope without embedding rendered values or executable database queries.',
    inputDescription: 'An artifact name and versioned semantic graph definition containing node groups, relations, registered bindings, layout, theme, and optional actions.',
    outputDescription: 'The persisted artifact identity and its selected semantic root, mode, layout, and theme.',
    handlerKey: 'artifact.create',
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
    key: 'cmrq9cz2d0000zc7kcjh7bh2n',
    slug: 'organization.member.list',
    name: 'List Organization Members',
    description: 'Lists members of the active organization with filtering, pagination, and sorting.',
    objective: 'Return an authorized, deterministic page of organization members matching the requested role, status, name, email, or alias filters.',
    inputDescription: 'Optional role, status, name, email, and alias filters together with pagination and sorting options. All queries are constrained to the active organization.',
    outputDescription: 'A page of matching organization members with stable pagination metadata and the applied sort order.',
    handlerKey: 'organization.member.list',
    enabled: true,
  },
  {
    key: 'cmrq9cz2d0001zc7ka0h4fn19',
    slug: 'organization.member.read',
    name: 'Read Organization Members',
    description: 'Reads detailed information for one or more members of the active organization.',
    objective: 'Resolve member references only within the active organization and return all possible matches instead of guessing when names are ambiguous.',
    inputDescription: 'An object with members: string[], where each value may be a name, alias, email address, or userOrganizationKey.',
    outputDescription: 'Detailed matching members grouped by input reference, including multiple candidates for ambiguous names and explicit not-found results.',
    handlerKey: 'organization.member.read',
    enabled: true,
  },
  {
    key: 'cmrq9cz2d0002zc7k4n1ddp4c',
    slug: 'organization.member.add',
    name: 'Add Organization Member',
    description: 'Adds an existing Vorinthex user to the active organization without sending an invitation.',
    objective: 'Create an organization membership for an existing, unambiguously resolved Vorinthex user with an authorized initial role.',
    inputDescription: 'An object with member: string and role: owner | admin | moderator | viewer. The member may be identified by userKey, email, or alias and must already exist in Vorinthex.',
    outputDescription: 'The created organization membership, or explicit ambiguous, not-found, already-member, or authorization details without sending an invite.',
    handlerKey: 'organization.member.add',
    enabled: true,
  },
  {
    key: 'cmrq9cz2d0003zc7k7kt67z2u',
    slug: 'organization.member.role.update',
    name: 'Update Organization Member Role',
    description: 'Updates the role of one or more members in the active organization.',
    objective: 'Apply authorized role changes without allowing privilege escalation, owner takeover, or removal of the final owner, then synchronize inherited agent access.',
    inputDescription: 'An object with members: string[] and role: owner | admin | moderator | viewer. The actor cannot grant above their own role, an admin cannot change an owner, the final owner cannot be demoted, and actors normally cannot elevate themselves.',
    outputDescription: 'Per-member role update results plus inherited agent-access synchronization status, with ambiguous and unauthorized targets reported without guessing.',
    handlerKey: 'organization.member.role.update',
    enabled: true,
  },
  {
    key: 'cmrq9cz2d0004zc7kek6113m1',
    slug: 'organization.member.activate',
    name: 'Activate Organization Member',
    description: 'Activates one or more suspended or inactive members of the active organization.',
    objective: 'Restore organization use from existing membership state and resynchronize inherited agent access without creating new roles or scope access.',
    inputDescription: 'An object with members: string[]. Each reference is resolved only within the active organization and ambiguous names are never guessed.',
    outputDescription: 'Per-member activation and agent-access synchronization results without adding roles or scope relations that did not already exist.',
    handlerKey: 'organization.member.activate',
    enabled: true,
  },
  {
    key: 'cmrq9cz2d0005zc7kcpxy984n',
    slug: 'organization.member.suspend',
    name: 'Suspend Organization Member',
    description: 'Suspends one or more members while retaining their membership relations for later activation.',
    objective: 'Immediately block organization access, scope access, agent execution, and delegated agent execution for every resolved target.',
    inputDescription: 'An object with members: string[] and optional reason: string. Each reference is resolved only within the active organization and ambiguous names are never guessed.',
    outputDescription: 'Per-member suspension and immediate access-revocation results while preserving reusable membership relations.',
    handlerKey: 'organization.member.suspend',
    enabled: true,
  },
  {
    key: 'cmrq9cz2d0006zc7k5au50ucv',
    slug: 'organization.member.remove',
    name: 'Remove Organization Member',
    description: 'Removes one or more members from the active organization and revokes their access immediately.',
    objective: 'Block runtime access before cleanup, protect the final owner, and remove member relations, assignments, schedules, and active sessions safely.',
    inputDescription: 'An object with members: string[] and optional reason: string. The final owner can never be removed and ambiguous member references are never guessed.',
    outputDescription: 'Per-member removal, immediate access revocation, and cleanup status for scopeMembers, agentMembers, assignments, scheduled executions, and active sessions.',
    handlerKey: 'organization.member.remove',
    enabled: true,
  },
  {
    key: 'cmrqa58d00000047k2isb9l3x',
    slug: 'scope.list',
    name: 'List Scopes',
    description: 'Lists scopes the initiating user may read in the active organization with hierarchy filters and pagination.',
    objective: 'Return a cursor-paginated hierarchy projection containing only authorized scopes from the verified active organization, hiding archived scopes by default.',
    inputDescription: 'An object with optional query: string, status: active | archived, parentScopeKey: string | null, includeDescendants: boolean, limit: number, and cursor: string. Any organization context is server-verified rather than trusted from client input.',
    outputDescription: 'Scopes with key, name, description, parentScopeKey, active or archived status derived from deletedAt, position, path, and childCount plus nextCursor.',
    handlerKey: 'scope.list',
    enabled: true,
  },
  {
    key: 'cmrqa58d00001047kd0177kci',
    slug: 'scope.read',
    name: 'Read Scopes',
    description: 'Reads detailed information for one or more authorized scopes in the active organization.',
    objective: 'Resolve each scope reference by key, name, slug, alias, or path within the verified organization and return candidates instead of guessing ambiguous names.',
    inputDescription: 'An object with scopes: string[]. Every reference is resolved only among scopes the initiating user may read in the active organization.',
    outputDescription: 'Matches grouped by input with scope identity, description, status, parent, children, position, path, creation provenance, member and agent counts, and applicable policies; ambiguous inputs include every candidate.',
    handlerKey: 'scope.read',
    enabled: true,
  },
  {
    key: 'cmrqa58d00002047k884716z7',
    slug: 'scope.create',
    name: 'Create Scope',
    description: 'Creates a non-root scope, its hierarchy relation, and initial owner membership in one transaction.',
    objective: 'Create a validated scope under an authorized active parent in the verified organization, make the initiating creator its owner, emit an event, and commit atomically.',
    inputDescription: 'An object with name: string, optional description: string, parentScope: string | null, and position: number. Viewer actors are denied; parent references must resolve unambiguously in the same organization and may not be archived.',
    outputDescription: 'The created scope, parent relation, creator owner membership, and event result, or an explicit validation, duplicate-sibling, ambiguity, or authorization failure.',
    handlerKey: 'scope.create',
    enabled: true,
  },
  {
    key: 'cmrqa58d00003047kgzy45teb',
    slug: 'scope.update',
    name: 'Update Scope',
    description: 'Updates authorized display metadata for an active scope without changing hierarchy or lifecycle state.',
    objective: 'Safely change scope name, description, or explicitly allowed display metadata without moving, reordering, archiving, restoring, deleting, or changing members and agents.',
    inputDescription: 'An object with scope: string and optional name: string, description: string | null, and a tightly allow-listed metadata object. The scope must resolve unambiguously in the active organization; viewers are denied and moderator access is policy-controlled.',
    outputDescription: 'The updated scope metadata and event result, or an explicit ambiguity, archived-state, sibling-name-conflict, root-policy, or authorization failure.',
    handlerKey: 'scope.update',
    enabled: true,
  },
  {
    key: 'cmrqa58d00004047kf5lj7zpq',
    slug: 'scope.move',
    name: 'Move Scope',
    description: 'Moves or reorders an active scope within its organization and recalculates inherited access.',
    objective: 'Atomically update hierarchy and sibling position without self-parenting, descendant parenting, cross-organization movement, archived parents, graph cycles, or root movement.',
    inputDescription: 'An object with scope: string and optional parentScope: string | null and position: number. Both references must resolve unambiguously in the verified organization and the actor must be owner or admin.',
    outputDescription: 'The moved scope, resulting parent and position, access-synchronization results, and event result, or explicit cycle, root-policy, archived-parent, ambiguity, or authorization details.',
    handlerKey: 'scope.move',
    enabled: true,
  },
  {
    key: 'cmrqa58d00005047k7k803p46',
    slug: 'scope.archive',
    name: 'Archive Scope',
    description: 'Archives scopes without deleting their members, agents, relations, history, or audit data.',
    objective: 'Set deletedAt and immediately block new runs, memberships, assignments, mutations, schedules, and delegated execution while retaining readable audit state.',
    inputDescription: 'An object with scopes: string[], optional reason: string, and includeDescendants: boolean. Only owners and admins may archive; root is forbidden, ambiguous references are never guessed, and active children require explicit descendant inclusion.',
    outputDescription: 'A preview when impact is large and otherwise per-scope archive, descendant, agent, run-policy, access-block, and event results.',
    handlerKey: 'scope.archive',
    enabled: true,
  },
  {
    key: 'cmrqa58d00006047k5dw98u07',
    slug: 'scope.restore',
    name: 'Restore Scope',
    description: 'Restores archived scopes while preserving explicit grants and keeping scheduled work paused.',
    objective: 'Clear deletedAt only for archived scopes under active parents, then recalculate effective access and inherited agent memberships without automatically resuming schedules.',
    inputDescription: 'An object with scopes: string[] and optional includeDescendants: boolean. Only owners and admins may restore; every parent must already be active and ambiguous references are never guessed.',
    outputDescription: 'Per-scope restore, descendant, access-synchronization, inherited-agent, paused-schedule, and event results.',
    handlerKey: 'scope.restore',
    enabled: true,
  },
  {
    key: 'cmrqa58d00007047kdkdjagm8',
    slug: 'scope.remove',
    name: 'Remove Scope',
    description: 'Permanently removes an archived empty leaf scope through owner-only confirmed cleanup.',
    objective: 'Validate destructive removal, create audit or tombstone state, atomically detach relations and delete or anonymize the scope, and never leave partial deletion.',
    inputDescription: 'An object with scopes: string[], confirmation: string, and optional reason: string. The initiating human must be an owner; root is forbidden; every scope must be archived, childless, free of active runs, and unambiguously resolved in the verified organization.',
    outputDescription: 'Per-scope validation and atomic removal results covering children, members, agents, runs, artifacts, schedules, sources, memories, policies, events, graph relations, retention, tombstone, and emitted audit event.',
    handlerKey: 'scope.remove',
    enabled: true,
  },
  ...ACCESS_DOMAIN_DEFINITIONS.map(([slug, name, description], index) => ({
    key: accessSeedKey('action', index),
    slug,
    name,
    description,
    objective: description,
    inputDescription: `Strict local input for ${slug}; all identifiers are resolved inside the authenticated organization.`,
    outputDescription: `A safe structured ${slug} result with explicit ambiguity and authorization decisions.`,
    handlerKey: slug,
    enabled: true,
  })),
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

/** Only generic runtime primitives are persisted as actions. Domain workflows are tools. */
export const SEEDED_ACTIONS = ACTION_DEFINITIONS.map((definition, index) => ({
  key: `cmruntimeaction${String(index + 1).padStart(10, '0')}`,
  slug: definition.id,
  name: definition.id.split('-').map((word) => word[0]!.toUpperCase() + word.slice(1)).join(' '),
  description: `Generic ${definition.id} runtime primitive.`,
  objective: `Execute the provider- and domain-neutral ${definition.id} primitive.`,
  inputDescription: `Validated input for ${definition.id}.`,
  outputDescription: `Normalized ${definition.id} result.`,
  handlerKey: definition.id,
  enabled: true,
}));

export const SEEDED_PROVIDERS = [
  {
    key: 'cmrl6mtn60005a1b23aushlt0',
    slug: 'openai',
    name: 'OpenAI',
    handlerKey: 'openai',
  },
  {
    key: 'cmrl6mtn60006a1b23aushlt0',
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
    key: 'cmrl6mtn60012a1b23aushlt0',
    slug: 'aws-polly',
    name: 'AWS Polly',
    handlerKey: 'aws-polly',
  },
  {
    key: 'cmrl6mtn60013a1b23aushlt0',
    slug: 'aws-transcribe',
    name: 'AWS Transcribe',
    handlerKey: 'aws-transcribe',
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
    key: 'cmnovapremiermodel0000001',
    slug: 'amazon.nova-premier',
    name: 'Amazon Nova Premier',
    description: 'Amazon Nova model for the deepest analysis, final reviews, and high-risk decisions.',
    supportedUseCases: 'Deep analysis, final review, high-risk decisions, strategic reasoning, and complex agent execution.',
    enabled: true,
  },
  {
    key: 'cmnovapromodel00000000001',
    slug: 'amazon.nova-pro',
    name: 'Amazon Nova Pro',
    description: 'Amazon Nova model for building features, coding, tool use, and iterative execution.',
    supportedUseCases: 'Feature development, coding, tool use, iterative workflows, and general-purpose agent execution.',
    enabled: true,
  },
  {
    key: 'cmnova2litemodel00000001',
    slug: 'amazon.nova-2-lite',
    name: 'Amazon Nova 2 Lite',
    description: 'Amazon Nova model for fast, economical agent steps, routing, classification, and simpler tasks.',
    supportedUseCases: 'Fast agent steps, routing, classification, extraction, and lightweight task execution.',
    enabled: true,
  },
  {
    key: 'cmnova2sonicmodel00000001',
    slug: 'amazon.nova-2-sonic',
    name: 'Amazon Nova 2 Sonic',
    description: 'Amazon Nova model for real-time text and voice chat, orchestrator dialogue, and low-latency calls.',
    supportedUseCases: 'Real-time text and voice chat, orchestrator dialogue, and low-latency conversational AI.',
    enabled: true,
  },
  {
    key: 'cmpollygenerativemodel0001',
    slug: 'amazon.polly-generative',
    name: 'Amazon Polly Generative Engine',
    description: 'Amazon Polly generative speech engine for longer narrations and saved audio files.',
    supportedUseCases: 'Long-form narration, saved audio files, voice synthesis, and speech generation.',
    enabled: true,
  },
  {
    key: 'cmtitanembedv2model0000001',
    slug: 'amazon.titan-embed-text-v2',
    name: 'Amazon Titan Text Embeddings V2',
    description: 'Amazon Bedrock-native embedding model optimized for retrieval-augmented generation workloads.',
    supportedUseCases: 'Retrieval-augmented generation, semantic search, vector retrieval, classification, and document similarity.',
    enabled: true,
  },
  {
    key: 'cmawstranscribemodel00001',
    slug: 'aws.transcribe-standard',
    name: 'AWS Transcribe Standard',
    description: 'AWS speech recognition service for file transcription.',
    supportedUseCases: 'Audio file transcription, meeting transcripts, captions, and speech-to-text.',
    enabled: true,
  },
] as const;

const LEGACY_SEEDED_MODEL_ACTIONS = [
  {
    key: 'cmnova2sonicaction0000001',
    modelSlug: 'amazon.nova-2-sonic',
    actionSlug: 'core.chat',
    priority: 100,
    enabled: true,
  },
  {
    key: 'cmtitanembedv2action0000001',
    modelSlug: 'amazon.titan-embed-text-v2',
    actionSlug: 'core.embedd',
    priority: 100,
    enabled: true,
  },
  {
    key: 'cmpollygenerativeaction0001',
    modelSlug: 'amazon.polly-generative',
    actionSlug: 'core.speak',
    priority: 100,
    enabled: true,
  },
  {
    key: 'cmawstranscribeaction00001',
    modelSlug: 'aws.transcribe-standard',
    actionSlug: 'core.transcribe',
    priority: 100,
    enabled: true,
  },
] as const;

/** Model bindings are owned by actions and selected by descending priority. */
export const SEEDED_MODEL_ACTIONS = ACTION_DEFINITIONS.flatMap((definition, actionIndex) =>
  definition.models.map((binding, modelIndex) => ({
    key: `cmmodelaction${String(actionIndex * 10 + modelIndex + 1).padStart(11, '0')}`,
    modelSlug: binding.model,
    actionSlug: definition.id,
    priority: binding.priority,
    enabled: true,
  })),
);

export const SEEDED_MODEL_PROVIDERS = [
  {
    key: 'cmnovapremierroute0000001',
    modelSlug: 'amazon.nova-premier',
    providerSlug: 'aws-bedrock',
    providerModelId: 'amazon.nova-premier-v1:0',
    enabled: true,
  },
  {
    key: 'cmnovaproroute0000000001',
    modelSlug: 'amazon.nova-pro',
    providerSlug: 'aws-bedrock',
    providerModelId: 'amazon.nova-pro-v1:0',
    enabled: true,
  },
  {
    key: 'cmnova2literoute00000001',
    modelSlug: 'amazon.nova-2-lite',
    providerSlug: 'aws-bedrock',
    providerModelId: 'amazon.nova-2-lite-v1:0',
    enabled: true,
  },
  {
    key: 'cmnova2sonicroute00000001',
    modelSlug: 'amazon.nova-2-sonic',
    providerSlug: 'aws-bedrock',
    providerModelId: 'amazon.nova-2-sonic-v1:0',
    enabled: true,
  },
  {
    key: 'cmtitanembedv2route0000001',
    modelSlug: 'amazon.titan-embed-text-v2',
    providerSlug: 'aws-bedrock',
    providerModelId: 'amazon.titan-embed-text-v2:0',
    enabled: true,
  },
  {
    key: 'cmpollygenerativeroute0001',
    modelSlug: 'amazon.polly-generative',
    providerSlug: 'aws-polly',
    providerModelId: 'generative',
    enabled: true,
  },
  {
    key: 'cmawstranscriberoute000001',
    modelSlug: 'aws.transcribe-standard',
    providerSlug: 'aws-transcribe',
    providerModelId: 'standard',
    enabled: true,
  },
] as const;

const RETIRED_TOOL_SEEDS = [
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
    key: 'cmartifactcreatetool00000001',
    slug: 'artifact.create',
    name: 'Create Artifact',
    description: 'Create a validated semantic graph artifact from live bindings in the active scope.',
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
  {
    key: 'cmrq9cz2d0007zc7k4v4q4whb',
    slug: 'organization.member.list',
    name: 'List Organization Members',
    description: 'List members of the active organization with role, status, name, email, and alias filters plus pagination and sorting.',
    scopeKey: null,
    enabled: true,
  },
  {
    key: 'cmrq9cz2d0008zc7k7sn83r0b',
    slug: 'organization.member.read',
    name: 'Read Organization Members',
    description: 'Resolve and read detailed member information within the active organization without guessing when identifiers are ambiguous.',
    scopeKey: null,
    enabled: true,
  },
  {
    key: 'cmrq9cz2d0009zc7k05ibgf92',
    slug: 'organization.member.add',
    name: 'Add Organization Member',
    description: 'Add an existing Vorinthex user to the active organization without sending an invitation.',
    scopeKey: null,
    enabled: true,
  },
  {
    key: 'cmrq9cz2d000azc7k8yng41s2',
    slug: 'organization.member.role.update',
    name: 'Update Organization Member Role',
    description: 'Update roles for members of the active organization while enforcing role hierarchy and last-owner safeguards.',
    scopeKey: null,
    enabled: true,
  },
  {
    key: 'cmrq9cz2d000bzc7ke0rcefp3',
    slug: 'organization.member.activate',
    name: 'Activate Organization Member',
    description: 'Reactivate organization access for suspended or inactive members and resynchronize inherited agent access.',
    scopeKey: null,
    enabled: true,
  },
  {
    key: 'cmrq9cz2d000czc7kg2g5bl7b',
    slug: 'organization.member.suspend',
    name: 'Suspend Organization Member',
    description: 'Immediately block organization, scope, agent, and delegated execution access while preserving membership relations.',
    scopeKey: null,
    enabled: true,
  },
  {
    key: 'cmrq9cz2d000dzc7kag01brhn',
    slug: 'organization.member.remove',
    name: 'Remove Organization Member',
    description: 'Remove members, immediately revoke runtime access, and clean related access, assignments, schedules, and sessions.',
    scopeKey: null,
    enabled: true,
  },
  {
    key: 'cmrqa58d00008047kbmi935wk',
    slug: 'scope.list',
    name: 'List Scopes',
    description: 'List only scopes the initiating user may read in the active organization, with hierarchy filters and cursor pagination.',
    scopeKey: null,
    enabled: true,
  },
  {
    key: 'cmrqa58d00009047k9qyc894u',
    slug: 'scope.read',
    name: 'Read Scopes',
    description: 'Resolve and read one or more authorized scopes by key, name, slug, alias, or path without guessing ambiguous matches.',
    scopeKey: null,
    enabled: true,
  },
  {
    key: 'cmrqa58d0000a047kana24343',
    slug: 'scope.create',
    name: 'Create Scope',
    description: 'Create a non-root scope, its hierarchy relation, and an owner membership for the initiating creator.',
    scopeKey: null,
    enabled: true,
  },
  {
    key: 'cmrqa58d0000b047k53668i0b',
    slug: 'scope.update',
    name: 'Update Scope',
    description: 'Update authorized scope metadata without moving, reordering, archiving, restoring, deleting, or changing access relations.',
    scopeKey: null,
    enabled: true,
  },
  {
    key: 'cmrqa58d0000c047kd7tk02xk',
    slug: 'scope.move',
    name: 'Move Scope',
    description: 'Move or reorder a scope within its organization while preventing cycles and synchronizing inherited access.',
    scopeKey: null,
    enabled: true,
  },
  {
    key: 'cmrqa58d0000d047kfmc9calr',
    slug: 'scope.archive',
    name: 'Archive Scope',
    description: 'Archive scopes without deleting their data and immediately block new operational activity.',
    scopeKey: null,
    enabled: true,
  },
  {
    key: 'cmrqa58d0000e047kgs0s9z72',
    slug: 'scope.restore',
    name: 'Restore Scope',
    description: 'Restore archived scopes under active parents while preserving grants and keeping schedules paused.',
    scopeKey: null,
    enabled: true,
  },
  {
    key: 'cmrqa58d0000f047k445s2232',
    slug: 'scope.remove',
    name: 'Remove Scope',
    description: 'Permanently remove an archived empty leaf scope through owner-only confirmation and atomic cleanup.',
    scopeKey: null,
    enabled: true,
  },
  ...ACCESS_DOMAIN_DEFINITIONS.map(([slug], index) => ({
    key: accessSeedKey('tool', index),
    slug,
    name: slug.split('.').map((part) => part[0]!.toUpperCase() + part.slice(1)).join(' '),
    description: `Safely execute ${slug} through the local domain authorization boundary.`,
    scopeKey: null,
    enabled: true,
  })),
] as const;

const RETIRED_TOOL_ACTION_SEEDS = [
  { key: 'cmrnc3nfh00053o7k3hfm3a82', toolSlug: 'ask.answer', actionSlug: 'core.chat', priority: 100, enabled: true },
  { key: 'cmrnc3nfh00063o7keg8h70ut', toolSlug: 'reason.solve', actionSlug: 'core.reason', priority: 100, enabled: true },
  { key: 'cmartifactcreatetoolaction001', toolSlug: 'artifact.create', actionSlug: 'artifact.create', priority: 100, enabled: true },
  { key: 'cmartifactreadtoolaction0001', toolSlug: 'artifact.read', actionSlug: 'artifact.read', priority: 100, enabled: true },
  { key: 'cmrnc3nfh00073o7kdi1aee17', toolSlug: 'image.create', actionSlug: 'image.generate', priority: 100, enabled: true },
  { key: 'cmrnc3nfh00083o7k3rz39zwp', toolSlug: 'audio.transcribe-file', actionSlug: 'audio.transcribe', priority: 100, enabled: true },
  { key: 'cmrnc3nfh00093o7kfijm2vjk', toolSlug: 'speech.narrate', actionSlug: 'audio.generate-speech', priority: 100, enabled: true },
  { key: 'cmrq9cz2d000ezc7k8rf873d2', toolSlug: 'organization.member.list', actionSlug: 'organization.member.list', priority: 100, enabled: true },
  { key: 'cmrq9cz2d000fzc7kfoa4dgxb', toolSlug: 'organization.member.read', actionSlug: 'organization.member.read', priority: 100, enabled: true },
  { key: 'cmrq9cz2d000gzc7k9z5921y9', toolSlug: 'organization.member.add', actionSlug: 'organization.member.add', priority: 100, enabled: true },
  { key: 'cmrq9cz2f000hzc7k4jo65sfg', toolSlug: 'organization.member.role.update', actionSlug: 'organization.member.role.update', priority: 100, enabled: true },
  { key: 'cmrq9cz2f000izc7kew4l2up1', toolSlug: 'organization.member.activate', actionSlug: 'organization.member.activate', priority: 100, enabled: true },
  { key: 'cmrq9cz2f000jzc7k8e088wbj', toolSlug: 'organization.member.suspend', actionSlug: 'organization.member.suspend', priority: 100, enabled: true },
  { key: 'cmrq9cz2f000kzc7kfiwu01bv', toolSlug: 'organization.member.remove', actionSlug: 'organization.member.remove', priority: 100, enabled: true },
  { key: 'cmrqa58d0000g047k6y3md5fx', toolSlug: 'scope.list', actionSlug: 'scope.list', priority: 100, enabled: true },
  { key: 'cmrqa58d3000h047kdw7ac224', toolSlug: 'scope.read', actionSlug: 'scope.read', priority: 100, enabled: true },
  { key: 'cmrqa58d3000i047kcj8d198y', toolSlug: 'scope.create', actionSlug: 'scope.create', priority: 100, enabled: true },
  { key: 'cmrqa58d3000j047k10pqbtuy', toolSlug: 'scope.update', actionSlug: 'scope.update', priority: 100, enabled: true },
  { key: 'cmrqa58d3000k047k5pfj0hxu', toolSlug: 'scope.move', actionSlug: 'scope.move', priority: 100, enabled: true },
  { key: 'cmrqa58d3000l047kf9zwbnsr', toolSlug: 'scope.archive', actionSlug: 'scope.archive', priority: 100, enabled: true },
  { key: 'cmrqa58d3000m047k7cpbc59c', toolSlug: 'scope.restore', actionSlug: 'scope.restore', priority: 100, enabled: true },
  { key: 'cmrqa58d3000n047kehxte6sq', toolSlug: 'scope.remove', actionSlug: 'scope.remove', priority: 100, enabled: true },
  ...ACCESS_DOMAIN_DEFINITIONS.map(([slug], index) => ({ key: accessSeedKey('link', index), toolSlug: slug, actionSlug: slug, priority: 100, enabled: true })),
] as const;

/** No executable tools or tool-action links are seeded. */
export const SEEDED_TOOLS = [] as const;
export const SEEDED_TOOL_ACTIONS = [] as const;

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
    key: 'cmrnlzf640002qc7kfp2qelhq',
    slug: 'launch',
    name: 'Launch',
    summary: 'Build, automate, deploy, and manage intelligent workflows, agents, and business processes from one unified workspace.',
    description: 'Build, automate, deploy, and manage intelligent workflows, agents, and business processes from one unified workspace.',
    position: 2,
    level: 2,
    parentKey: NEXUS_SCOPE_KEY,
  },
  {
    key: 'cmrnlzf640003qc7k4n8zesyz',
    slug: 'studio',
    name: 'Studio',
    summary: 'Create websites, apps, documents, images, videos, music, and code with AI powered creative and development tools.',
    description: 'Create websites, apps, documents, images, videos, music, and code with AI powered creative and development tools.',
    position: 3,
    level: 2,
    parentKey: NEXUS_SCOPE_KEY,
  },
  {
    key: 'cmrnlzf640004qc7kdvj99uva',
    slug: 'command',
    name: 'Command',
    summary: 'Manage AI executive teams and orchestrators that help lead strategy, operations, growth, finance, technology, and security.',
    description: 'Manage AI executive teams and orchestrators that help lead strategy, operations, growth, finance, technology, and security.',
    position: 7,
    level: 2,
    parentKey: NEXUS_SCOPE_KEY,
  },
  {
    key: 'cmrnlzf640005qc7kefvra0bn',
    slug: 'head-quarters',
    name: 'Head Quarters',
    summary: 'Collaborate across teams, projects, files, calendars, meetings, and communication in one centralized workspace.',
    description: 'Collaborate across teams, projects, files, calendars, meetings, and communication in one centralized workspace.',
    position: 4,
    level: 2,
    parentKey: NEXUS_SCOPE_KEY,
  },
  {
    key: 'cmrnlzf640006qc7kfjl23jc3',
    slug: 'replica',
    name: 'Replica',
    summary: 'Explore interactive demonstrations of every Vorinthex capability using realistic sample data before deploying your own.',
    description: 'Explore interactive demonstrations of every Vorinthex capability using realistic sample data before deploying your own.',
    position: 5,
    level: 2,
    parentKey: NEXUS_SCOPE_KEY,
  },
  {
    key: 'cmrnlzf640007qc7kd6a2g0o8',
    slug: 'pilot',
    name: 'Pilot',
    summary: 'Your conversational AI assistant that helps you navigate, operate, and get the most out of the entire Vorinthex platform.',
    description: 'Your conversational AI assistant that helps you navigate, operate, and get the most out of the entire Vorinthex platform.',
    position: 6,
    level: 2,
    parentKey: NEXUS_SCOPE_KEY,
  },
] as const;

type SeededOrchestratorSource = {
  name: string;
  role: string;
  provider: string;
  model: string;
  voice: string;
  skill: string;
};

type SeededVoice = Pick<Voice, 'provider' | 'model' | 'modelLabel' | 'voice' | 'label' | 'language' | 'format'>;

export const SEEDED_ORCHESTRATOR_SOURCES: SeededOrchestratorSource[] = [
  ['Atlas', 'CEO', 'Matthew'],
  ['Metis', 'CIO', 'Matthew'],
  ['Echo', 'CKO', 'Matthew'],
  ['Matrix', 'CDO', 'Matthew'],
  ['Hermes', 'COO', 'Matthew'],
  ['Harmony', 'CHRO', 'Tiffany'],
  ['Phoenix', 'CGO', 'Matthew'],
  ['Iris', 'CCO', 'Tiffany'],
  ['Orbit', 'CMO', 'Tiffany'],
  ['Apollo', 'CSO', 'Matthew'],
  ['Athena', 'CPO', 'Tiffany'],
  ['Forge', 'CTO', 'Matthew'],
  ['Aura', 'CXO', 'Tiffany'],
  ['Pillar', 'CQO', 'Matthew'],
  ['Helios', 'CAIO', 'Matthew'],
  ['Vulcan', 'CAO', 'Matthew'],
  ['Ledger', 'CFO', 'Matthew'],
  ['Mercury', 'CRO', 'Matthew'],
  ['Sentinel', 'CISO', 'Matthew'],
  ['Themis', 'CLO', 'Tiffany'],
].map(([name, role, voice]) => ({
  name,
  role,
  provider: 'aws-bedrock',
  model: 'amazon.nova-2-sonic-v1:0',
  voice,
  skill: SEEDED_ORCHESTRATOR_SKILLS[name as keyof typeof SEEDED_ORCHESTRATOR_SKILLS],
}));

const SEEDED_FOUNDER_ORCHESTRATORS = {
  'oscar@vorinthex.com': 'Atlas',
  'josef@vorinthex.com': 'Orbit',
  'frank@vorinthex.com': 'Mercury',
  'vincent@vorinthex.com': 'Iris',
  'anton@vorinthex.com': 'Apollo',
} as const;

export const SEEDED_VOICES: SeededVoice[] = [
  {
    provider: 'aws-bedrock',
    model: 'amazon.nova-2-sonic-v1:0',
    modelLabel: 'Amazon Nova 2 Sonic',
    voice: 'Tiffany',
    label: 'Lyra',
    language: 'en-US',
    format: 'mp3',
  },
  {
    provider: 'aws-bedrock',
    model: 'amazon.nova-2-sonic-v1:0',
    modelLabel: 'Amazon Nova 2 Sonic',
    voice: 'Matthew',
    label: 'Orion',
    language: 'en-US',
    format: 'mp3',
  },
];

/** Converts the retired persisted action before strict action parsing occurs. */
async function migrateRetiredCoreAskAction(): Promise<void> {
  await db.query(aql`
    FOR action IN ${db.collection('actions')}
      FILTER action.slug == ${'core.ask'}
      UPDATE action WITH { slug: 'core.chat', handlerKey: 'core.chat' } IN ${db.collection('actions')}
  `);
}

async function removeAllTools(): Promise<void> {
  for (const collection of ['agentTools', 'toolActions', 'tools']) {
    await db.query(aql`FOR document IN ${db.collection(collection)} REMOVE document IN ${db.collection(collection)}`);
  }
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
  const existing = await getOrchestratorByName(seed.name);
  if (!existing) {
    const key = newId();
    await insertOrchestrator({
      key,
      name: seed.name,
      role: seed.role,
      voiceId: voice.key,
      skill: seed.skill,
      createdAt: now(),
      updatedAt: now(),
    });
    return { collection: 'orchestrators', key, status: 'created' };
  }

  const patch: Partial<Omit<Orchestrator, 'key' | 'embedding'>> = {
    role: seed.role,
    voiceId: voice.key,
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
  action: upsertSeedAction,
  provider: upsertSeedProvider,
  model: upsertSeedModel,
  modelAction: upsertSeedModelAction,
  modelProvider: upsertSeedModelProvider,
}): Promise<SeedResult[]> {
  const results: SeedResult[] = [];
  for (const seed of SEEDED_ACTIONS) results.push(await upserters.action(seed));
  for (const seed of SEEDED_PROVIDERS) results.push(await upserters.provider(seed));
  for (const seed of SEEDED_MODELS) results.push(await upserters.model(seed));
  for (const seed of SEEDED_MODEL_ACTIONS) results.push(await upserters.modelAction(seed));
  for (const seed of SEEDED_MODEL_PROVIDERS) results.push(await upserters.modelProvider(seed));
  return results;
}

export async function seedCoreDbNodes(): Promise<SeedResult[]> {
  await migrateRetiredCoreAskAction();
  await removeAllTools();
  const results = await seedAiRuntimeNodes();

  results.push(await upsertSeedOrganization(SEEDED_ORGANIZATION));
  const rootOrganization = await getRootOrganization();
  if (!rootOrganization) throw new SeedReferenceError('organization', 'root', 'core seed');
  const scopes = getDefaultScopeRepository();
  const organizationScopes = [...await scopes.listScopes(rootOrganization.key)];
  const scopesBySlug = new Map(organizationScopes.map((scope) => [scope.slug, scope]));
  const actualKeysBySeedKey = new Map<string, string>();
  for (const seed of SEEDED_SCOPES) {
    let existing = scopesBySlug.get(seed.slug);
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


  for (const product of SEEDED_PRODUCTS) {
    results.push(await upsertSeedProduct(product));
  }

  for (const voice of SEEDED_VOICES) {
    results.push(await upsertSeedVoice(voice));
  }

  for (const orchestrator of SEEDED_ORCHESTRATOR_SOURCES) {
    results.push(await upsertSeedOrchestrator(orchestrator));
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
