import { expect, test } from 'bun:test';
import { scopeAgentRestoreTool } from './scope-agent-restore';
test('scope.agent.restore definition', () => { expect(scopeAgentRestoreTool.name).toBe('scope.agent.restore'); expect(scopeAgentRestoreTool.inputSchema).toBeDefined(); });
