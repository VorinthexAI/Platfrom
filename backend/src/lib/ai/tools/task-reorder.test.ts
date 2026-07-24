import { expect, test } from 'bun:test';
import { taskReorderTool } from './task-reorder';
test('task.reorder definition', () => { expect(taskReorderTool.name).toBe('task.reorder'); expect(taskReorderTool.inputSchema).toBeDefined(); });
