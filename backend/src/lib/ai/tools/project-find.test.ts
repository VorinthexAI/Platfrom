import { expect, test } from 'bun:test';
import { projectFindTool } from './project-find';
test('project.find definition', () => { expect(projectFindTool.name).toBe('project.find'); expect(projectFindTool.inputSchema).toBeDefined(); });
