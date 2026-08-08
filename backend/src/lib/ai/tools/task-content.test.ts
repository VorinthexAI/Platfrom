import { expect, test } from 'bun:test';
import { taskContentTool } from './task-content';
test('task.archive definition', () => { expect(taskContentTool.name).toBe('task.archive'); expect(taskContentTool.inputSchema).toBeDefined(); });
