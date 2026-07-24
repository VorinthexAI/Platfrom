import { expect, test } from 'bun:test';
import { organizationProviderReadTool } from './organization-provider-read';
test('organization.provider.read definition', () => { expect(organizationProviderReadTool.name).toBe('organization.provider.read'); expect(organizationProviderReadTool.inputSchema).toBeDefined(); });
