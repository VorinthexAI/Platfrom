import { z } from 'zod';
import { createSystemEmailService, emailDraftCreateIfNeededInputSchema, type EmailService } from '@/lib/email-inbox/service';
import type { ToolContext } from './tool-context';
import { ToolExecutionError } from './tool-context';
import type { ToolEventRecorder } from '@/lib/ai/events/service';

export const inboxSyncInputSchema = z.object({ connectorKey: z.string().cuid() }).strict();
export const inboxSubscribeInputSchema = z.object({
  connectorKey: z.string().cuid(),
  notificationHistoryId: z.string().regex(/^\d+$/).optional(),
}).strict();

export interface TrustedEmailToolDependencies {
  context: ToolContext;
  email?: EmailService;
  recordEvent?: ToolEventRecorder;
}

function systemActor(context: ToolContext) {
  if (context.principal.kind !== 'system') throw new ToolExecutionError('TOOL_FORBIDDEN', 'Inbox ingestion tools are system-only.');
  return { userKey: 'system', organizationKey: context.organizationKey, scopeKey: context.runtimeScopeKey };
}

export const TRUSTED_EMAIL_TOOL_DEFINITIONS = Object.freeze([
  {
    name: 'inbox.sync',
    inputSchema: inboxSyncInputSchema,
    async execute(rawInput: unknown, dependencies: TrustedEmailToolDependencies) {
      const input = inboxSyncInputSchema.parse(rawInput);
      return (dependencies.email ?? createSystemEmailService()).initialSync(systemActor(dependencies.context), input.connectorKey);
    },
  },
  {
    name: 'inbox.subscribe',
    inputSchema: inboxSubscribeInputSchema,
    async execute(rawInput: unknown, dependencies: TrustedEmailToolDependencies) {
      const input = inboxSubscribeInputSchema.parse(rawInput);
      const service = dependencies.email ?? createSystemEmailService();
      const actor = systemActor(dependencies.context);
      return input.notificationHistoryId
        ? service.ingestSubscriptionNotification(actor, input.connectorKey, input.notificationHistoryId)
        : service.continueSubscription(actor, input.connectorKey);
    },
  },
  {
    name: 'email.draft.create-if-needed',
    inputSchema: emailDraftCreateIfNeededInputSchema,
    async execute(rawInput: unknown, dependencies: TrustedEmailToolDependencies) {
      const input = emailDraftCreateIfNeededInputSchema.parse(rawInput);
      return (dependencies.email ?? createSystemEmailService()).createDraftIfNeeded(systemActor(dependencies.context), input);
    },
  },
] as const);

export type TrustedEmailToolName = typeof TRUSTED_EMAIL_TOOL_DEFINITIONS[number]['name'];
