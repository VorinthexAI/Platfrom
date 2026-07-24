import { expect, test } from 'bun:test';
import { projectCreateTool } from './project-create';
test('project.create definition', () => { expect(projectCreateTool.name).toBe('project.create'); expect(projectCreateTool.inputSchema).toBeDefined(); });
