import { expect, test } from 'bun:test';
import { agentMemberSyncTool } from './agent-member-sync';
test('agent.member.sync definition', () => { expect(agentMemberSyncTool.name).toBe('agent.member.sync'); expect(agentMemberSyncTool.inputSchema).toBeDefined(); });
