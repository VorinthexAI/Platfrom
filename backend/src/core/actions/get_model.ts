type ModelCategory = 'reasoning' | 'coding' | 'fast' | 'image' | 'embedding';
type ModelLevel = 'xhigh' | 'high' | 'medium' | 'low';

const MODEL_DEFAULTS: Record<ModelCategory, Record<ModelLevel, string>> = {
  reasoning: {
    xhigh: 'anthropic/claude-opus-4-8',
    high: 'anthropic/claude-sonnet-4-6',
    medium: 'openai/gpt-5.1',
    low: 'anthropic/claude-haiku-4-5',
  },
  coding: {
    xhigh: 'anthropic/claude-opus-4-8',
    high: 'openai/gpt-5.1-codex',
    medium: 'openai/gpt-5-codex',
    low: 'openai/gpt-5-codex',
  },
  fast: {
    xhigh: 'anthropic/claude-sonnet-4-6',
    high: 'anthropic/claude-haiku-4-5',
    medium: 'openai/gpt-4o-mini',
    low: 'openai/gpt-4o-mini',
  },
  image: {
    xhigh: 'openai/gpt-image-2',
    high: 'google/nano-banana-pro',
    medium: 'google/nano-banana-pro',
    low: 'stability/sdxl',
  },
  embedding: {
    xhigh: 'text-embedding-3-large',
    high: 'text-embedding-3-small',
    medium: 'text-embedding-3-small',
    low: 'text-embedding-3-small',
  },
};

interface GetModelInput {
  category: ModelCategory;
  level?: ModelLevel;
  override?: string;
}

export async function get_model({
  category,
  level = 'medium',
  override,
}: GetModelInput): Promise<string> {
  if (override) return override;
  return MODEL_DEFAULTS[category][level];
}

