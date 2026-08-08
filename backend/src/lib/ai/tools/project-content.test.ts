import { expect, test } from 'bun:test';
import { projectContentTool } from './project-content';
test('project.archive definition', () => { expect(projectContentTool.name).toBe('project.archive'); expect(projectContentTool.inputSchema).toBeDefined(); });
