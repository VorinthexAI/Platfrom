import { expect, test } from 'bun:test';
import { organizationRestoreTool } from './organization-restore';
test('organization.restore definition', () => { expect(organizationRestoreTool.name).toBe('organization.restore'); expect(organizationRestoreTool.inputSchema).toBeDefined(); });
