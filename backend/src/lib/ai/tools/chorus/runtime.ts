import { z } from 'zod';
import type { DomainToolContext } from '@/lib/ai/domain-tools/execute';
import { chorusToolInputSchemas, type ChorusToolSlug } from '@/lib/ai/chorus/tools';
import { chorusToolOutputSchema, isChorusToolName, type ChorusToolOutput } from './registry';

export type ChorusToolExecutor = (tool: ChorusToolSlug, input: unknown, context: DomainToolContext) => Promise<unknown>;

export interface ChorusToolDependencies {
  execute?: ChorusToolExecutor;
}

function assertMemberContext(context: DomainToolContext) {
  if (context.principal.kind !== 'member'
    || context.principal.userOrganization.organizationId !== context.organizationKey
    || context.principal.userOrganization.status !== 'active') {
    throw new Error('An active human organization member is required to execute Chorus tools.');
  }
}

/** Validates a Chorus invocation and dispatches only to an explicitly injected executor. */
export async function runChorusTool<Name extends ChorusToolSlug>(name: Name, rawInput: unknown, context: DomainToolContext, dependencies: ChorusToolDependencies = {}): Promise<ChorusToolOutput> {
  if (!isChorusToolName(name)) throw new Error(`Unknown Chorus tool: ${String(name)}`);
  assertMemberContext(context);
  const input = chorusToolInputSchemas[name].parse(rawInput);
  const output = dependencies.execute
    ? await dependencies.execute(name, input, context)
    : { tool: name, status: 'not_implemented' as const, data: { code: 'CHORUS_NOT_IMPLEMENTED' } };
  const parsed = chorusToolOutputSchema.parse(output);
  if (parsed.tool !== name) throw new Error('Chorus tool executor returned output for a different tool.');
  return parsed;
}
