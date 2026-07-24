import { expect, test } from 'bun:test';
import { milestoneCreateTool } from './milestone-create';
test('milestone.create definition', () => { expect(milestoneCreateTool.name).toBe('milestone.create'); expect(milestoneCreateTool.inputSchema).toBeDefined(); });
