import { expect, test } from 'bun:test';
import { milestoneArchiveTool } from './milestone-archive';
test('milestone.archive definition', () => { expect(milestoneArchiveTool.name).toBe('milestone.archive'); expect(milestoneArchiveTool.inputSchema).toBeDefined(); });
