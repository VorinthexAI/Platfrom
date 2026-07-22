import { expect, test } from 'bun:test'; import { webSearchAction } from './web-search'; test('defines web-search', () => expect(webSearchAction.id).toBe('web-search'));
