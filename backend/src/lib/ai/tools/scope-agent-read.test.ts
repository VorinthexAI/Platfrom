import { expect, test } from 'bun:test';
import { scopeAgentReadTool } from './scope-agent-read';
test('scope.agent.read definition', () => { expect(scopeAgentReadTool.name).toBe('scope.agent.read'); expect(scopeAgentReadTool.inputSchema).toBeDefined(); });
