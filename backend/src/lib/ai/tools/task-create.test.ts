import { expect, test } from 'bun:test';
import { taskCreateTool } from './task-create';
test('task.create definition', () => { expect(taskCreateTool.name).toBe('task.create'); expect(taskCreateTool.inputSchema).toBeDefined(); });
