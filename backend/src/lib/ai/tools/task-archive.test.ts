import { expect, test } from 'bun:test';
import { taskArchiveTool } from './task-archive';
test('task.archive definition', () => { expect(taskArchiveTool.name).toBe('task.archive'); expect(taskArchiveTool.inputSchema).toBeDefined(); });
