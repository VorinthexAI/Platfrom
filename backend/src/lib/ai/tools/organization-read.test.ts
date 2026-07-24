import { expect, test } from 'bun:test';
import { organizationReadTool } from './organization-read';
test('organization.read definition', () => { expect(organizationReadTool.name).toBe('organization.read'); expect(organizationReadTool.inputSchema).toBeDefined(); });
