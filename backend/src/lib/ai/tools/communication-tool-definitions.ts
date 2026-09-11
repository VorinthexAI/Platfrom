import { communicationStaffReplyInputSchema } from '@/lib/user-inbox/schemas';
import { userInboxService, type UserInboxService } from '@/lib/user-inbox/service';
import type { ToolContext } from './tool-context';

export interface TrustedCommunicationToolDependencies {
  context: ToolContext;
  staffUserKey?: string;
  requestKey?: string;
  userInbox?: UserInboxService;
}

export const TRUSTED_COMMUNICATION_TOOL_DEFINITIONS = Object.freeze([{
  name: 'communication.staff.reply',
  inputSchema: communicationStaffReplyInputSchema,
  async execute(rawInput: unknown, dependencies: TrustedCommunicationToolDependencies) {
    if (dependencies.context.principal.kind !== 'system' || !dependencies.staffUserKey || !dependencies.requestKey) throw new Error('Trusted staff context is required.');
    return (dependencies.userInbox ?? userInboxService).staffReply(rawInput, dependencies.staffUserKey, dependencies.requestKey);
  },
}] as const);

export type TrustedCommunicationToolName = typeof TRUSTED_COMMUNICATION_TOOL_DEFINITIONS[number]['name'];
