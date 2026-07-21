import { runTool, type ToolDependencies } from '@/lib/ai/tools';

export interface AskInput {
  skill: string;
  message: string;
}

export type AskDependencies = ToolDependencies;

/** Runs an orchestrator request through its only exposed tool. */
export async function ask({ skill, message }: AskInput, dependencies: AskDependencies = {}): Promise<string> {
  return runTool('orchestrator.chat', skill, { message }, dependencies);
}
