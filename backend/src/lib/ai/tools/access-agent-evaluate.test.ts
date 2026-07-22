import { expect, test } from 'bun:test';
import { accessAgentEvaluateTool } from './access-agent-evaluate';
test('access.agent.evaluate definition', () => { expect(accessAgentEvaluateTool.name).toBe('access.agent.evaluate'); expect(accessAgentEvaluateTool.inputSchema).toBeDefined(); });
