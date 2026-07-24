import { expect, test } from 'bun:test';
import { projectDeleteTool } from './project-delete';
test('project.delete definition', () => { expect(projectDeleteTool.name).toBe('project.delete'); expect(projectDeleteTool.inputSchema).toBeDefined(); });
