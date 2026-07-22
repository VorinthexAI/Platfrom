import { expect, test } from 'bun:test';
import { milestoneScheduleTool } from './milestone-schedule';
test('milestone.schedule definition', () => { expect(milestoneScheduleTool.name).toBe('milestone.schedule'); expect(milestoneScheduleTool.inputSchema).toBeDefined(); });
