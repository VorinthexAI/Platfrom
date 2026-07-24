import { expect, test } from 'bun:test';
import { taskRenameTool } from './task-rename';
test('task.rename definition', () => { expect(taskRenameTool.name).toBe('task.rename'); expect(taskRenameTool.inputSchema).toBeDefined(); });
