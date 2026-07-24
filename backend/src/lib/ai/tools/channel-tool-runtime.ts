import { z } from 'zod';
import type { DomainToolContext } from '@/lib/ai/domain-tools/execute';
import { channelToolInputSchemas, type ChannelToolSlug } from '@/lib/ai/channel/tools';
import { channelToolOutputSchema, isChannelToolName, type ChannelToolOutput } from './channel-tool-registry';

export type ChannelToolExecutor = (tool: ChannelToolSlug, input: unknown, context: DomainToolContext) => Promise<unknown>;

export interface ChannelToolDependencies {
  execute?: ChannelToolExecutor;
}

function assertMemberContext(context: DomainToolContext) {
  if (context.principal.kind !== 'member'
    || context.principal.userOrganization.organizationId !== context.organizationKey
    || context.principal.userOrganization.status !== 'active') {
    throw new Error('An active human organization member is required to execute Channel tools.');
  }
}

/** Validates a Channel invocation and dispatches only to an explicitly injected executor. */
export async function runChannelTool<Name extends ChannelToolSlug>(name: Name, rawInput: unknown, context: DomainToolContext, dependencies: ChannelToolDependencies = {}): Promise<ChannelToolOutput> {
  if (!isChannelToolName(name)) throw new Error(`Unknown Channel tool: ${String(name)}`);
  assertMemberContext(context);
  const input = channelToolInputSchemas[name].parse(rawInput);
  const output = dependencies.execute
    ? await dependencies.execute(name, input, context)
    : { tool: name, status: 'not_implemented' as const, data: { code: 'CHANNEL_NOT_IMPLEMENTED' } };
  const parsed = channelToolOutputSchema.parse(output);
  if (parsed.tool !== name) throw new Error('Channel tool executor returned output for a different tool.');
  return parsed;
}
