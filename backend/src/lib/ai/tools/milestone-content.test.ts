import { expect, test } from 'bun:test';
import { milestoneContentTool } from './milestone-content';
test('milestone.archive definition', () => { expect(milestoneContentTool.name).toBe('milestone.archive'); expect(milestoneContentTool.inputSchema).toBeDefined(); });
