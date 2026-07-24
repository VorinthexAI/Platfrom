import { expect, test } from 'bun:test';
import { taskListTool } from './task-list';
test('task.list definition', () => { expect(taskListTool.name).toBe('task.list'); expect(taskListTool.inputSchema).toBeDefined(); });
