import { getOrchestratorById } from '@/lib/db/orchestrators.node';
import { ask, type AskDependencies } from './ask';
import { streamTool, type ToolDependencies } from '@/lib/ai/tools';

export class OrchestratorNotFoundError extends Error {
  constructor(orchestratorId: string) {
    super(`orchestrator not found: ${orchestratorId}`);
  }
}

/** Loads the orchestrator's skill and pipes it, with the message, into ask(). */
export async function askOrchestrator(orchestratorId: string, message: string, dependencies?: AskDependencies): Promise<string> {
  const orchestrator = await getOrchestratorById(orchestratorId);
  if (!orchestrator) throw new OrchestratorNotFoundError(orchestratorId);
  return ask({ skill: orchestrator.skill, message }, dependencies);
}

export async function* streamOrchestrator(orchestratorId: string, message: string, dependencies?: ToolDependencies) {
  const orchestrator = await getOrchestratorById(orchestratorId);
  if (!orchestrator) throw new OrchestratorNotFoundError(orchestratorId);
  yield* streamTool('chat', orchestrator.skill, { message }, dependencies);
}
