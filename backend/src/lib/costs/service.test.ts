import { describe, expect, test } from 'bun:test';
import { PURCHASE_GRANT_RULES, TOOL_COST_RULES } from './index';
import { costService } from './service';

describe('public Spark costs', () => {
  test('projects publicly listed debit rules with display metadata and excludes grants', async () => {
    const { charges } = await costService.listCharges();
    const staticCharges = charges.filter((charge) => charge.kind === 'static');
    const listedRules = Object.entries(TOOL_COST_RULES).filter(([, rule]) => rule.showInPricing !== false);
    expect(staticCharges).toHaveLength(listedRules.length + 2);
    expect(staticCharges.slice(0, listedRules.length).map(({ key }) => key)).toEqual(listedRules.map(([key]) => key));
    expect(charges.some(({ key }) => key === 'image.caption')).toBe(false);
    expect(charges).toContainEqual(expect.objectContaining({ key: 'document.parse', name: 'Upload a document' }));
    expect(charges).toContainEqual(expect.objectContaining({ key: 'book.create', name: 'Create an audio book', description: 'Generate and save a complete audio book.' }));
    expect(charges).toContainEqual(expect.objectContaining({ key: 'book.extend', name: 'Extend an audio book', description: 'Generate and save an additional audio book chapter.' }));
    expect(charges).toContainEqual(expect.objectContaining({ key: 'highlight.create', description: 'Create a generated highlight from an image collection.' }));
    expect(charges).toContainEqual(expect.objectContaining({ key: 'visual-identity.create', name: 'Create a visual identity', description: 'Create a visual identity from selected images.' }));
    expect(charges.some(({ key }) => key === 'subject.create')).toBe(false);
    expect(JSON.stringify(charges).toLowerCase()).not.toContain('photo');
    expect(charges).toContainEqual(expect.objectContaining({ key: 'storage', kind: 'storage', sparkCost: '30', unit: 'gb-month' }));
    expect(charges).toContainEqual(expect.objectContaining({ key: 'email.tone.create', name: 'Create a Signal writing tone', description: 'Build a reusable writing tone from connected email examples.' }));
    expect(charges).toContainEqual(expect.objectContaining({ key: 'inbox.sync', kind: 'static', name: 'Connect and initially sync email', description: expect.stringContaining('private Signal inbox'), sparkCost: '100', unit: 'invocation' }));
    expect(charges).toContainEqual(expect.objectContaining({ key: 'inbox.subscribe', kind: 'static', name: 'Receive connected email', description: expect.stringContaining('private Signal inbox'), sparkCost: '1', unit: 'new-email' }));
    expect(charges.some(({ key }) => key === 'connected-inbox')).toBe(false);
    expect(charges).toContainEqual(expect.objectContaining({ key: 'ai-usage', kind: 'variable' }));
    for (const productId of Object.keys(PURCHASE_GRANT_RULES)) expect(charges.some(({ key }) => key === productId)).toBe(false);
    for (const rule of Object.values(TOOL_COST_RULES)) {
      expect(rule.name.length).toBeGreaterThan(0);
      expect(rule.description.length).toBeGreaterThan(0);
    }
  });
});
