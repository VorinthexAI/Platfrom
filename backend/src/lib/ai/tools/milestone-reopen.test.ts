import { expect, test } from 'bun:test';
import { milestoneReopenTool } from './milestone-reopen';
test('milestone.reopen definition', () => { expect(milestoneReopenTool.name).toBe('milestone.reopen'); expect(milestoneReopenTool.inputSchema).toBeDefined(); });
