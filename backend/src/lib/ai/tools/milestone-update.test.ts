import { expect, test } from 'bun:test';
import { milestoneUpdateTool } from './milestone-update';
test('milestone.update definition', () => { expect(milestoneUpdateTool.name).toBe('milestone.update'); expect(milestoneUpdateTool.inputSchema).toBeDefined(); });
