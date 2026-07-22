import { expect, test } from 'bun:test';
import { organizationProviderEnableTool } from './organization-provider-enable';
test('organization.provider.enable definition', () => { expect(organizationProviderEnableTool.name).toBe('organization.provider.enable'); expect(organizationProviderEnableTool.inputSchema).toBeDefined(); });
