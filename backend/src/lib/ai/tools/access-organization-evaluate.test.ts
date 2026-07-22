import { expect, test } from 'bun:test';
import { accessOrganizationEvaluateTool } from './access-organization-evaluate';
test('access.organization.evaluate definition', () => { expect(accessOrganizationEvaluateTool.name).toBe('access.organization.evaluate'); expect(accessOrganizationEvaluateTool.inputSchema).toBeDefined(); });
