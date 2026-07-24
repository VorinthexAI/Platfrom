import { expect, test } from 'bun:test';
import { milestoneRenameTool } from './milestone-rename';
test('milestone.rename definition', () => { expect(milestoneRenameTool.name).toBe('milestone.rename'); expect(milestoneRenameTool.inputSchema).toBeDefined(); });
