import { expect, test } from 'bun:test';
import { organizationProjectSearchTool } from './organization-project-search';
test('organization.project.search definition', () => { expect(organizationProjectSearchTool.name).toBe('organization.project.search'); expect(organizationProjectSearchTool.inputSchema).toBeDefined(); });
