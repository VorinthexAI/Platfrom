import { expect, test } from 'bun:test';
import { artifactCreateTool } from './artifact-create';
test('artifact.create definition', () => { expect(artifactCreateTool.name).toBe('artifact.create'); expect(artifactCreateTool.inputSchema).toBeDefined(); });
