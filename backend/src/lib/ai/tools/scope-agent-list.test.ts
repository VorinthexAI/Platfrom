import { expect, test } from 'bun:test';
import { scopeAgentListTool } from './scope-agent-list';
test('scope.agent.list definition', () => { expect(scopeAgentListTool.name).toBe('scope.agent.list'); expect(scopeAgentListTool.inputSchema).toBeDefined(); });
