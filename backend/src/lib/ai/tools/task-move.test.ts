import { expect, test } from 'bun:test';
import { taskMoveTool } from './task-move';
test('task.move definition', () => { expect(taskMoveTool.name).toBe('task.move'); expect(taskMoveTool.inputSchema).toBeDefined(); });
