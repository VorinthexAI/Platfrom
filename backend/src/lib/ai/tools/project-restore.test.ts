import { expect, test } from 'bun:test';
import { projectRestoreTool } from './project-restore';
test('project.restore definition', () => { expect(projectRestoreTool.name).toBe('project.restore'); expect(projectRestoreTool.inputSchema).toBeDefined(); });
