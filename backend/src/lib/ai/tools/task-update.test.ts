import { expect, test } from 'bun:test';
import { taskUpdateTool } from './task-update';
test('task.update definition', () => { expect(taskUpdateTool.name).toBe('task.update'); expect(taskUpdateTool.inputSchema).toBeDefined(); });
