import { expect, test } from 'bun:test';
import { agentMemberReadTool } from './agent-member-read';
test('agent.member.read definition', () => { expect(agentMemberReadTool.name).toBe('agent.member.read'); expect(agentMemberReadTool.inputSchema).toBeDefined(); });
