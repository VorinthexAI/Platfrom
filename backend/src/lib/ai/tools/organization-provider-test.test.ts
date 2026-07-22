import { expect, test } from 'bun:test';
import { organizationProviderTestTool } from './organization-provider-test';
test('organization.provider.test definition', () => { expect(organizationProviderTestTool.name).toBe('organization.provider.test'); expect(organizationProviderTestTool.inputSchema).toBeDefined(); });
