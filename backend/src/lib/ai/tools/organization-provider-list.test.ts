import { expect, test } from 'bun:test';
import { organizationProviderListTool } from './organization-provider-list';
test('organization.provider.list definition', () => { expect(organizationProviderListTool.name).toBe('organization.provider.list'); expect(organizationProviderListTool.inputSchema).toBeDefined(); });
