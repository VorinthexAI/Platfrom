import { expect, test } from 'bun:test';
import { taskRewriteTool } from './task-rewrite';
test('task.rewrite definition', () => { expect(taskRewriteTool.name).toBe('task.rewrite'); expect(taskRewriteTool.inputSchema).toBeDefined(); });
