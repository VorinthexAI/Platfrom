import { expect, test } from 'bun:test';
import { milestoneMoveTool } from './milestone-move';
test('milestone.move definition', () => { expect(milestoneMoveTool.name).toBe('milestone.move'); expect(milestoneMoveTool.inputSchema).toBeDefined(); });
