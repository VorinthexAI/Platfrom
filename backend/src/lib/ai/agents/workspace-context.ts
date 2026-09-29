import type { ToolContext } from '@/lib/ai/tools/tool-context';
import type { AppSearchRetrieval } from '@/lib/app-search/service';

export type WorkspaceContextResult = { navigation?: AppSearchRetrieval[] };

export async function gatherWorkspaceContext(
  _message: string,
  _context: ToolContext,
  _dependencies?: unknown,
  _history?: readonly string[],
): Promise<WorkspaceContextResult> {
  return {};
}
