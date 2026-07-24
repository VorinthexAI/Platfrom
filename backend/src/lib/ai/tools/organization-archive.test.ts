import { expect, test } from 'bun:test';
import { organizationArchiveTool } from './organization-archive';
test('organization.archive definition', () => { expect(organizationArchiveTool.name).toBe('organization.archive'); expect(organizationArchiveTool.inputSchema).toBeDefined(); });
