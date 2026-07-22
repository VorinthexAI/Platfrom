import { expect, test } from 'bun:test';
import { milestoneChangeStatusTool } from './milestone-change-status';
test('milestone.change-status definition', () => { expect(milestoneChangeStatusTool.name).toBe('milestone.change-status'); expect(milestoneChangeStatusTool.inputSchema).toBeDefined(); });
