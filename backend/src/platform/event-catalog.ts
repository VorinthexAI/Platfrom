import { z } from 'zod';

export const landingEventSlugs = [
  'landing.page_viewed', 'landing.product_entered', 'landing.orchestrator_entered',
  'landing.capability_entered', 'landing.rock_entered', 'landing.cta_clicked',
  'landing.cave_opened', 'landing.cave_closed', 'landing.audio_played',
  'landing.ambient_audio_started', 'landing.mission_voice_played',
  'landing.mission_voice_cancelled', 'landing.biome_fragment_collected',
  'landing.crystal_collected', 'landing.crystal_room_filled',
  'landing.fragment_discovered', 'landing.fragment_collect_clicked',
  'landing.fragment_join_to_collect_clicked', 'landing.collect_gate_shown',
  'waitlist.form_started', 'waitlist.submit_clicked', 'waitlist.signup_submitted',
  'waitlist.email_verified', 'auth.signin_opened', 'auth.signin_email_sent',
  'auth.magic_link_authenticated', 'auth.signin_authed_jump', 'auth.member_gate_opened',
  'waitlist.verify_jump_started', 'leaderboard.daily_digest_sent', 'legal.opened',
  'fragments.collected',
] as const;

export const serverEventSlugs = [
  'platform.sign_in_link_requested', 'platform.mfa_setup_started',
  'platform.mfa_enabled', 'platform.mfa_verified', 'waitlist.user_approved',
  'waitlist.signin_invite_sent', 'payment.checkout_created',
  'payment.checkout_completed', 'payment.ticket_purchased',
  'presence.session_expired', 'presence.session_joined', 'presence.session_left',
  'artifact.create',
  'organization.member.list', 'organization.member.read', 'organization.member.add',
  'organization.member.role.update', 'organization.member.activate',
  'organization.member.suspend', 'organization.member.remove',
  'scope.list', 'scope.read', 'scope.create', 'scope.update', 'scope.move',
  'scope.archive', 'scope.restore', 'scope.remove',
  'scope.member.list', 'scope.member.read', 'scope.member.add', 'scope.member.role.update',
  'scope.member.activate', 'scope.member.suspend', 'scope.member.remove',
  'scope.agent.list', 'scope.agent.read', 'scope.agent.add', 'scope.agent.move',
  'scope.agent.archive', 'scope.agent.restore', 'scope.agent.remove', 'scope.agent.access-threshold.update',
  'agent.member.list', 'agent.member.read', 'agent.member.grant', 'agent.member.revoke', 'agent.member.sync',
  'organization.provider.list', 'organization.provider.read', 'organization.provider.enable',
  'organization.provider.disable', 'organization.provider.test',
  'organization.read', 'organization.update', 'organization.archive', 'organization.restore',
  'access.organization.evaluate', 'access.scope.evaluate', 'access.agent.evaluate',
  'access.organization.explain', 'access.scope.explain', 'access.agent.explain',
] as const;

export const userEventSlugs = [
  'waitlist:question', 'waitlist:founder_note_viewed', 'waitlist:ticket_viewed',
] as const;

export const providerEventSlugs = [
  'email.opened', 'email.delivered', 'email.bounced', 'email.complained',
] as const;

export const runtimeEventSlugs = [
  'agent.started', 'agent.completed', 'agent.failed',
  'step.started', 'step.completed', 'step.failed',
  'tool.called', 'tool.completed', 'tool.failed',
  'model.called', 'model.completed', 'model.failed',
  'artifact.created', 'artifact.updated', 'artifact.deleted', 'artifact.resolved', 'artifact.used', 'guardrail.blocked',
] as const;

export const registeredEventSlugs = [
  ...landingEventSlugs,
  ...serverEventSlugs,
  ...userEventSlugs,
  ...providerEventSlugs,
  ...runtimeEventSlugs,
] as const;

export const eventSlugSchema = z.enum(registeredEventSlugs);
export type EventSlug = z.infer<typeof eventSlugSchema>;
export const landingEventSlugSchema = z.enum(landingEventSlugs);
export const clientEventSlugSchema = landingEventSlugSchema;
export type ClientEventSlug = z.infer<typeof clientEventSlugSchema>;
export const runtimeEventSlugSchema = z.enum(runtimeEventSlugs);
export type RuntimeEventSlug = z.infer<typeof runtimeEventSlugSchema>;

export const runtimeEventDataSchema = z.object({
  runKey: z.string().cuid().optional(),
  invocationKey: z.string().cuid().optional(),
  stepKey: z.string().cuid().optional(),
  callKey: z.string().cuid().optional(),
  agentKey: z.string().cuid().optional(),
  agentSlug: z.string().trim().min(1).max(120).optional(),
  agentName: z.string().trim().min(1).max(120).optional(),
  toolKey: z.string().cuid().optional(),
  toolSlug: z.string().trim().min(1).max(160).optional(),
  toolName: z.string().trim().min(1).max(100).optional(),
  actionKey: z.string().cuid().optional(),
  actionSlug: z.string().trim().min(1).max(160).optional(),
  actionName: z.string().trim().min(1).max(100).optional(),
  modelKey: z.string().cuid().optional(),
  providerKey: z.string().cuid().optional(),
  nodeType: z.string().trim().min(1).max(120).optional(),
  nodeKey: z.string().cuid().optional(),
  status: z.string().trim().min(1).max(80).optional(),
  reason: z.string().trim().min(1).max(500).optional(),
  inputTokens: z.number().int().nonnegative().optional(),
  outputTokens: z.number().int().nonnegative().optional(),
  elapsedMs: z.number().int().nonnegative().optional(),
}).strict();

export type RuntimeEventData = z.infer<typeof runtimeEventDataSchema>;
export interface RuntimeEventInput {
  scopeId: string;
  userId?: string | null;
  slug: RuntimeEventSlug;
  data: RuntimeEventData;
}
export type RuntimeEventRecorder = (input: RuntimeEventInput) => Promise<void>;
