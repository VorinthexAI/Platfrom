import { describe, expect, test } from 'bun:test';
import { appSearchCollectionSlugSchema } from '@/lib/app-search/service';
import { defaultAssistantCapabilityRegistry, type AssistantSurface } from '@/lib/ai/personal-assistant/capabilities';
import { MODEL_TOOL_NAMES } from './index';
import { APP_SEARCH_COLLECTIONS_BY_OVERLAPPING_TOOL, APP_SEARCH_OVERLAPPING_TOOL_NAMES } from './search-routing-policy';

describe('app search routing policy', () => {
  test('maps every overlapping public tool to valid app.search collections', () => {
    expect(MODEL_TOOL_NAMES.filter((name) => name === 'app.search')).toHaveLength(1);
    for (const [tool, slugs] of Object.entries(APP_SEARCH_COLLECTIONS_BY_OVERLAPPING_TOOL)) {
      expect(MODEL_TOOL_NAMES).toContain(tool);
      for (const slug of slugs) expect(appSearchCollectionSlugSchema.parse(slug)).toBe(slug);
    }
  });

  test('keeps one canonical text-search route on every workspace surface', () => {
    const surfaces: AssistantSurface[] = ['knowledge-workspace', 'media-workspace', 'book-workspace', 'travel-workspace', 'signal-workspace'];
    for (const surface of surfaces) {
      const names = defaultAssistantCapabilityRegistry.resolve(surface).map(({ definition }) => definition.name);
      expect(names.filter((name) => name === 'app.search')).toHaveLength(1);
      for (const overlapping of APP_SEARCH_OVERLAPPING_TOOL_NAMES) expect(names).not.toContain(overlapping);
    }
  });

  test('retains search capabilities with distinct semantics', () => {
    const modelNames = new Set(MODEL_TOOL_NAMES);
    for (const specialized of ['web.search', 'image.search', 'conversation.search', 'agent.query', 'content.neighbors', 'email.similar.find', 'folder.find', 'document.find']) expect(modelNames.has(specialized)).toBe(true);
  });
});
