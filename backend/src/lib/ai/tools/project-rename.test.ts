import { expect, test } from 'bun:test';
import { projectRenameTool } from './project-rename';
test('project.rename definition', () => { expect(projectRenameTool.name).toBe('project.rename'); expect(projectRenameTool.inputSchema).toBeDefined(); });
