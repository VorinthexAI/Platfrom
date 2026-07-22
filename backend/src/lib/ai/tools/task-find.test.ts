import { expect, test } from 'bun:test';
import { taskFindTool } from './task-find';
test('task.find definition', () => { expect(taskFindTool.name).toBe('task.find'); expect(taskFindTool.inputSchema).toBeDefined(); });
