import { getOrchestratorById } from '@/lib/db/orchestrators.node';
import { ask } from './ask';

export class OrchestratorNotFoundError extends Error {
  constructor(orchestratorId: string) {
    super(`orchestrator not found: ${orchestratorId}`);
  }
}

/** Loads the orchestrator's skill and pipes it, with the message, into ask(). */
export async function askOrchestrator(orchestratorId: string, message: string): Promise<string> {
  const orchestrator = await getOrchestratorById(orchestratorId);
  if (!orchestrator) throw new OrchestratorNotFoundError(orchestratorId);
  return ask({ skill: orchestrator.skill, message });
}
