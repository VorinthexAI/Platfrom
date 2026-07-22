import { expect, test } from 'bun:test';
import { projectListTool } from './project-list';
test('project.list definition', () => { expect(projectListTool.name).toBe('project.list'); expect(projectListTool.inputSchema).toBeDefined(); });
