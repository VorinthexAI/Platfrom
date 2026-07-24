import { expect, test } from 'bun:test';
import { agentMemberGrantTool } from './agent-member-grant';
test('agent.member.grant definition', () => { expect(agentMemberGrantTool.name).toBe('agent.member.grant'); expect(agentMemberGrantTool.inputSchema).toBeDefined(); });
