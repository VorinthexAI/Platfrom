import { expect, test } from 'bun:test'; import { embedAction } from './embed'; test('defines embed', () => expect(embedAction.id).toBe('embed'));
