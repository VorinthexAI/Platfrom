import { expect, test } from 'bun:test';
import { taskSummarizeTool } from './task-summarize';
test('task.summarize definition', () => { expect(taskSummarizeTool.name).toBe('task.summarize'); expect(taskSummarizeTool.inputSchema).toBeDefined(); });
