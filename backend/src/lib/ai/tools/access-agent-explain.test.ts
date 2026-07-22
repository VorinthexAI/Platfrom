import { expect, test } from 'bun:test';
import { accessAgentExplainTool } from './access-agent-explain';
test('access.agent.explain definition', () => { expect(accessAgentExplainTool.name).toBe('access.agent.explain'); expect(accessAgentExplainTool.inputSchema).toBeDefined(); });
