import { describe, expect, test } from 'bun:test';
import { CHANNEL_TOOL_DEFINITIONS, CHANNEL_TOOL_SLUGS } from '@/lib/ai/channel/tools';
import { TOOL_DEFINITIONS, TOOL_NAMES } from '../index';
import { runChannelTool } from './channel-tool-runtime';

const context = {
  organizationKey: 'organization-1',
  runtimeScopeKey: 'scope-1',
  principal: {
    kind: 'member',
    user: { key: 'user-1' },
    userOrganization: { key: 'membership-1', organizationId: 'organization-1', status: 'active' },
  },
} as any;

describe('unified Channel tools', () => {
  test('registers every existing Channel definition in the unified registry', () => {
    expect(CHANNEL_TOOL_DEFINITIONS).toHaveLength(CHANNEL_TOOL_SLUGS.length);
    expect(CHANNEL_TOOL_SLUGS.every((name) => TOOL_NAMES.includes(name as any))).toBe(true);
    expect(CHANNEL_TOOL_SLUGS.every((name) => TOOL_DEFINITIONS.some((definition) => definition.name === name))).toBe(true);
  });

  test('validates input and output around an injected executor', async () => {
    let received: any;
    const result = await runChannelTool('channel.list', { scopeKey: 'scope-1' }, context, {
      execute: async (tool, input, receivedContext) => {
        received = { tool, input, receivedContext };
        return { tool, status: 'completed', data: { channels: [] } };
      },
    });
    expect(result).toEqual({ tool: 'channel.list', status: 'completed', data: { channels: [] } });
    expect(received).toMatchObject({ tool: 'channel.list', input: { scopeKey: 'scope-1', includeDeleted: false, limit: 50 }, receivedContext: context });
    await expect(runChannelTool('channel.list', { scopeKey: 'scope-1', extra: true }, context)).rejects.toThrow();
    await expect(runChannelTool('channel.list', { scopeKey: 'scope-1' }, context, {
      execute: async () => ({ tool: 'message.list', status: 'completed' }),
    })).rejects.toThrow('different tool');
  });

  test('routes unimplemented tools to an explicit non-execution result', async () => {
    await expect(runChannelTool('channel.list', { scopeKey: 'scope-1' }, context)).resolves.toEqual({
      tool: 'channel.list',
      status: 'not_implemented',
      data: { code: 'CHANNEL_NOT_IMPLEMENTED' },
    });
  });
});
