import { expect, test } from 'bun:test';
import { milestoneRestoreTool } from './milestone-restore';
test('milestone.restore definition', () => { expect(milestoneRestoreTool.name).toBe('milestone.restore'); expect(milestoneRestoreTool.inputSchema).toBeDefined(); });
