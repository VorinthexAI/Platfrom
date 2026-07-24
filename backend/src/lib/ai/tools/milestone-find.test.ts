import { expect, test } from 'bun:test';
import { milestoneFindTool } from './milestone-find';
test('milestone.find definition', () => { expect(milestoneFindTool.name).toBe('milestone.find'); expect(milestoneFindTool.inputSchema).toBeDefined(); });
