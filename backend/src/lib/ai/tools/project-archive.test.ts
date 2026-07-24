import { expect, test } from 'bun:test';
import { projectArchiveTool } from './project-archive';
test('project.archive definition', () => { expect(projectArchiveTool.name).toBe('project.archive'); expect(projectArchiveTool.inputSchema).toBeDefined(); });
