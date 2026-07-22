import { expect, test } from 'bun:test';
import { scopeAgentRemoveTool } from './scope-agent-remove';
test('scope.agent.remove definition', () => { expect(scopeAgentRemoveTool.name).toBe('scope.agent.remove'); expect(scopeAgentRemoveTool.inputSchema).toBeDefined(); });
