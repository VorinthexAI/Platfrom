import { insertEvent } from '@/lib/db/events.node';
import { newId } from '@/lib/ids';
import {
  agentAccessEventDataSchema,
  agentAccessEventSlugSchema,
  type AgentAccessEventData,
  type AgentAccessEventSlug,
} from '@/platform/event-catalog';

export type AgentAccessEventEmitter = (input: {
  scopeKey: string;
  userId?: string | null;
  slug: AgentAccessEventSlug;
  data: AgentAccessEventData;
}) => Promise<void>;

/**
 * Best-effort ledger write for agent-access lifecycle events. Authorization
 * correctness never depends on these events landing — they exist for audit,
 * listing invalidation, and observability — so failures are logged, not thrown.
 */
export const emitAgentAccessEvent: AgentAccessEventEmitter = async (input) => {
  try {
    await insertEvent({
      key: newId(),
      scopeId: input.scopeKey,
      userId: input.userId ?? null,
      slug: agentAccessEventSlugSchema.parse(input.slug),
      data: agentAccessEventDataSchema.parse(input.data),
      createdAt: new Date().toISOString(),
    });
  } catch (error) {
    console.warn('failed to record agent access event', {
      slug: input.slug,
      error: error instanceof Error ? error.message : String(error),
    });
  }
};
