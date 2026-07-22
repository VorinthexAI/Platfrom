import { expect, test } from 'bun:test';
import { taskCompleteTool } from './task-complete';
test('task.complete definition', () => { expect(taskCompleteTool.name).toBe('task.complete'); expect(taskCompleteTool.inputSchema).toBeDefined(); });
