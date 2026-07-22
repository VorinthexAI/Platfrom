import { expect, test } from 'bun:test';
import { projectUpdateTool } from './project-update';
test('project.update definition', () => { expect(projectUpdateTool.name).toBe('project.update'); expect(projectUpdateTool.inputSchema).toBeDefined(); });
