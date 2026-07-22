import { expect, test } from 'bun:test';
import { milestoneDeleteTool } from './milestone-delete';
test('milestone.delete definition', () => { expect(milestoneDeleteTool.name).toBe('milestone.delete'); expect(milestoneDeleteTool.inputSchema).toBeDefined(); });
