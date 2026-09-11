import { formatMicroSparks, INBOX_INITIAL_SYNC_SPARKS, INBOX_NEW_EMAIL_SPARKS, STORAGE_SPARKS_PER_GB_MONTH, TOOL_COST_RULES } from './index';
import { publicSparkCostsSchema, type PublicSparkCosts } from './contracts';

export interface CostService {
  listCharges(): Promise<PublicSparkCosts>;
}

export function createCostService(): CostService {
  return Object.freeze({
    async listCharges() {
      return publicSparkCostsSchema.parse({
        capabilityCosts: Object.fromEntries(Object.entries(TOOL_COST_RULES).filter(([, rule]) => rule.showInPricing === false).map(([key, rule]) => [key, {
          sparkCost: formatMicroSparks(rule.microSparks),
          microSparkCost: rule.microSparks,
          unit: 'invocation' as const,
        }])),
        charges: [
          ...Object.entries(TOOL_COST_RULES).filter(([, rule]) => rule.showInPricing !== false).map(([key, rule]) => ({
            key,
            kind: 'static' as const,
            name: rule.name,
            description: rule.description,
            sparkCost: formatMicroSparks(rule.microSparks),
            unit: rule.quantity ?? 'invocation',
          })),
          {
            key: 'inbox.sync',
            kind: 'static' as const,
            name: 'Connect and initially sync email',
            description: 'Import connected email into your private Signal inbox once. Provider API calls and later manual refreshes are not charged.',
            sparkCost: String(INBOX_INITIAL_SYNC_SPARKS),
            unit: 'invocation' as const,
          },
          {
            key: 'inbox.subscribe',
            kind: 'static' as const,
            name: 'Receive connected email',
            description: 'Add one genuinely new message from connected email to your private Signal inbox.',
            sparkCost: String(INBOX_NEW_EMAIL_SPARKS),
            unit: 'new-email' as const,
          },
          {
            key: 'storage',
            kind: 'storage' as const,
            name: 'Storage',
            description: 'Stored files are measured continuously and charged hourly.',
            sparkCost: String(STORAGE_SPARKS_PER_GB_MONTH),
            unit: 'gb-month' as const,
          },
          {
            key: 'ai-usage',
            kind: 'variable' as const,
            name: 'AI actions',
            description: 'Other AI actions, including text, image, video, and audio generation, consume Sparks based on usage.',
          },
        ],
      });
    },
  });
}

export const costService = createCostService();
