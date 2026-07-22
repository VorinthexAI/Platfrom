import { expect, test } from 'bun:test';
import { taskReopenTool } from './task-reopen';
test('task.reopen definition', () => { expect(taskReopenTool.name).toBe('task.reopen'); expect(taskReopenTool.inputSchema).toBeDefined(); });
