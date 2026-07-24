import { expect, test } from 'bun:test';
import { taskTranslateTool } from './task-translate';
test('task.translate definition', () => { expect(taskTranslateTool.name).toBe('task.translate'); expect(taskTranslateTool.inputSchema).toBeDefined(); });
