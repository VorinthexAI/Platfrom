import { expect, test } from 'bun:test';
import { taskChangeStatusTool } from './task-change-status';
test('task.change-status definition', () => { expect(taskChangeStatusTool.name).toBe('task.change-status'); expect(taskChangeStatusTool.inputSchema).toBeDefined(); });
