import { expect, test } from 'bun:test';
import { organizationContentTool } from './organization-content';
test('organization.archive definition', () => { expect(organizationContentTool.name).toBe('organization.archive'); expect(organizationContentTool.inputSchema).toBeDefined(); });
