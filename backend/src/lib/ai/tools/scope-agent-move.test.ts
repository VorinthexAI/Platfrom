import { expect, test } from 'bun:test';
import { scopeAgentMoveTool } from './scope-agent-move';
test('scope.agent.move definition', () => { expect(scopeAgentMoveTool.name).toBe('scope.agent.move'); expect(scopeAgentMoveTool.inputSchema).toBeDefined(); });
