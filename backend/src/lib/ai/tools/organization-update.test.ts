import { expect, test } from 'bun:test';
import { organizationUpdateTool } from './organization-update';
test('organization.update definition', () => { expect(organizationUpdateTool.name).toBe('organization.update'); expect(organizationUpdateTool.inputSchema).toBeDefined(); });
