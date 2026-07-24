import { expect, test } from 'bun:test';
import { organizationProviderDisableTool } from './organization-provider-disable';
test('organization.provider.disable definition', () => { expect(organizationProviderDisableTool.name).toBe('organization.provider.disable'); expect(organizationProviderDisableTool.inputSchema).toBeDefined(); });
