import { expect, test } from 'bun:test';
import { milestoneListTool } from './milestone-list';
test('milestone.list definition', () => { expect(milestoneListTool.name).toBe('milestone.list'); expect(milestoneListTool.inputSchema).toBeDefined(); });
