import { expect, test } from 'bun:test';
import { accessOrganizationExplainTool } from './access-organization-explain';
test('access.organization.explain definition', () => { expect(accessOrganizationExplainTool.name).toBe('access.organization.explain'); expect(accessOrganizationExplainTool.inputSchema).toBeDefined(); });
