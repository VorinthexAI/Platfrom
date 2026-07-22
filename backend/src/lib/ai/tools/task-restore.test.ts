import { expect, test } from 'bun:test';
import { taskRestoreTool } from './task-restore';
test('task.restore definition', () => { expect(taskRestoreTool.name).toBe('task.restore'); expect(taskRestoreTool.inputSchema).toBeDefined(); });
