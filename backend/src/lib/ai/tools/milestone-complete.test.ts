import { expect, test } from 'bun:test';
import { milestoneCompleteTool } from './milestone-complete';
test('milestone.complete definition', () => { expect(milestoneCompleteTool.name).toBe('milestone.complete'); expect(milestoneCompleteTool.inputSchema).toBeDefined(); });
