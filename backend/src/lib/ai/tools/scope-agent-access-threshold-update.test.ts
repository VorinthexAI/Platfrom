import { expect, test } from 'bun:test';
import { scopeAgentAccessThresholdUpdateTool } from './scope-agent-access-threshold-update';
test('scope.agent.access-threshold.update definition', () => { expect(scopeAgentAccessThresholdUpdateTool.name).toBe('scope.agent.access-threshold.update'); expect(scopeAgentAccessThresholdUpdateTool.inputSchema).toBeDefined(); });
