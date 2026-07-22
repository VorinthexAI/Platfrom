import { expect, test } from 'bun:test';
import { agentMemberRevokeTool } from './agent-member-revoke';
test('agent.member.revoke definition', () => { expect(agentMemberRevokeTool.name).toBe('agent.member.revoke'); expect(agentMemberRevokeTool.inputSchema).toBeDefined(); });
