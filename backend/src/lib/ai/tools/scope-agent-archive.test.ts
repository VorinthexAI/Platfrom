import { expect, test } from 'bun:test';
import { scopeAgentArchiveTool } from './scope-agent-archive';
test('scope.agent.archive definition', () => { expect(scopeAgentArchiveTool.name).toBe('scope.agent.archive'); expect(scopeAgentArchiveTool.inputSchema).toBeDefined(); });
