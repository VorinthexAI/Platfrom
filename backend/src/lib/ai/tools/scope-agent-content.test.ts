import { expect, test } from 'bun:test';
import { scopeAgentContentTool } from './scope-agent-content';
test('scope.agent.archive definition', () => { expect(scopeAgentContentTool.name).toBe('scope.agent.archive'); expect(scopeAgentContentTool.inputSchema).toBeDefined(); });
