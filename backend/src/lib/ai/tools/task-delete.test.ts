import { expect, test } from 'bun:test';
import { taskDeleteTool } from './task-delete';
test('task.delete definition', () => { expect(taskDeleteTool.name).toBe('task.delete'); expect(taskDeleteTool.inputSchema).toBeDefined(); });
