import { expect, test } from 'bun:test';
import { agentMemberListTool } from './agent-member-list';
test('agent.member.list definition', () => { expect(agentMemberListTool.name).toBe('agent.member.list'); expect(agentMemberListTool.inputSchema).toBeDefined(); });
