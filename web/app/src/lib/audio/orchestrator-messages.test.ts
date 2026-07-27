import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { getOrchestratorsForCommand } from '@/lib/galaxy/registry-helpers';
import { MISSION_AUDIO_SRC, orchestratorMessageUrl } from './audio-store';

describe('orchestrator message assets', () => {
  test('publishes one playable personal message for every orchestrator landing page', async () => {
    const orchestrators = getOrchestratorsForCommand();
    expect(orchestrators).toHaveLength(20);

    for (const orchestrator of orchestrators) {
      const url = orchestratorMessageUrl(orchestrator.slug);
      expect(url).toBe(`/audio/entities/orchestrator-${orchestrator.slug}-message.mp3`);
      const asset = Bun.file(join(import.meta.dir, '../../../public', url));
      expect(await asset.exists()).toBe(true);
      expect(asset.size).toBeGreaterThan(0);
      expect(asset.type).toBe('audio/mpeg');
    }
  });

  test('publishes the generated Hunt briefing', async () => {
    expect(MISSION_AUDIO_SRC).toBe('/audio/brand/hunt-briefing.mp3');
    const asset = Bun.file(join(import.meta.dir, '../../../public', MISSION_AUDIO_SRC));
    expect(await asset.exists()).toBe(true);
    expect(asset.size).toBeGreaterThan(0);
    expect(asset.type).toBe('audio/mpeg');
  });
});
