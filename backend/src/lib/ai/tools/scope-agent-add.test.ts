import { expect, test } from 'bun:test';
import { scopeAgentAddTool } from './scope-agent-add';
test('scope.agent.add definition', () => { expect(scopeAgentAddTool.name).toBe('scope.agent.add'); expect(scopeAgentAddTool.inputSchema).toBeDefined(); });
