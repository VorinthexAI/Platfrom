import { expect, test } from 'bun:test';
import { projectMoveTool } from './project-move';
test('project.move definition', () => { expect(projectMoveTool.name).toBe('project.move'); expect(projectMoveTool.inputSchema).toBeDefined(); });
