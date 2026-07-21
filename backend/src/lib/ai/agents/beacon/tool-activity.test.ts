import { describe, expect, test } from 'bun:test';
import { newId } from '@/lib/ids';
import { AsyncEventChannel, createBeaconToolActivityProjector } from './tool-activity';

describe('Beacon tool activity projection', () => {
  test('correlates phases with a session-local id and excludes private runtime data', () => {
    const project = createBeaconToolActivityProjector();
    const invocationKey = newId();
    const base = {
      scopeId: newId(),
      userId: newId(),
      data: {
        invocationKey,
        runKey: newId(),
        agentKey: newId(), agentSlug: 'beacon', agentName: 'Beacon',
        toolKey: newId(), toolSlug: 'artifact.create', toolName: 'Create artifact',
        actionKey: newId(), actionSlug: 'artifact.create', actionName: 'Create artifact',
      },
    };
    const started = project({ ...base, slug: 'tool.called', data: { ...base.data, status: 'called' } });
    const completed = project({ ...base, slug: 'tool.completed', data: { ...base.data, status: 'completed', elapsedMs: 42 } });
    expect(started).toMatchObject({ invocationId: 'tool-1', phase: 'started', agent: { slug: 'beacon' }, tool: { slug: 'artifact.create' } });
    expect(completed).toMatchObject({ invocationId: 'tool-1', phase: 'completed', elapsedMs: 42 });
    expect(JSON.stringify(completed)).not.toContain(invocationKey);
    expect(JSON.stringify(completed)).not.toContain('Key');
  });

  test('streams queued values in order and closes cleanly', async () => {
    const channel = new AsyncEventChannel<number>();
    channel.push(1); channel.push(2); channel.close();
    const values: number[] = [];
    for await (const value of channel) values.push(value);
    expect(values).toEqual([1, 2]);
  });
});
