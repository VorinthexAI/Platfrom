import { describe, expect, test } from 'bun:test';
import type { ModelDefinition } from '@/lib/ai/models/types';
import type { ProviderAdapter, ProviderId } from '@/lib/ai/providers/types';
import {
  NoEligibleRouteError,
  ProviderNotEnabledForOrganizationError,
  RouteValidationError,
  UnknownModelError,
} from './errors';
import { selectRoute } from './select-route';
import { compareCandidates, rankCandidates, scoreCandidate, STRATEGY_WEIGHTS } from './scoring';
import type { RouteCandidate, RouterDependencies } from './types';

const ORG = 'org_test';

function stubAdapter(id: ProviderId): ProviderAdapter {
  return {
    id,
    name: id,
    async execute() {
      throw new Error('not executed in selection tests');
    },
  };
}

function adaptersFor(...ids: ProviderId[]): Partial<Record<ProviderId, ProviderAdapter>> {
  return Object.fromEntries(ids.map((id) => [id, stubAdapter(id)]));
}

function orgProvidersWith(...providerIds: ProviderId[]): RouterDependencies['organizationProviders'] {
  return {
    async listProviderIds() {
      return providerIds;
    },
  };
}

// Fixture models reuse real internal model ids (the ModelId enum) with
// controlled routes and profiles.
const claude: ModelDefinition = {
  id: 'anthropic.claude-sonnet',
  name: 'Claude Sonnet',
  actions: ['core.chat', 'core.reason'],
  actionProfiles: {
    'core.chat': { quality: 0.9, speed: 0.5, costEfficiency: 0.4, reliability: 0.95 },
    'core.reason': { quality: 0.95, speed: 0.4, costEfficiency: 0.4, reliability: 0.95 },
  },
  routes: [
    { providerId: 'anthropic', externalModelId: 'claude-sonnet-test', enabled: true },
    { providerId: 'openrouter', externalModelId: 'anthropic/claude-sonnet-test', enabled: true },
  ],
  enabled: true,
};

const gpt: ModelDefinition = {
  id: 'openai.gpt-5',
  name: 'GPT-5',
  actions: ['core.chat'],
  actionProfiles: {
    'core.chat': { quality: 0.8, speed: 0.6, costEfficiency: 0.9, reliability: 0.85 },
  },
  routes: [
    { providerId: 'openai', externalModelId: 'gpt-5-test', enabled: true },
    { providerId: 'azure-ai-foundry', externalModelId: 'gpt-5-deployment', enabled: false },
  ],
  enabled: true,
};

const disabledModel: ModelDefinition = {
  id: 'xai.grok',
  name: 'Grok (disabled)',
  actions: ['core.chat'],
  actionProfiles: {
    'core.chat': { quality: 1, speed: 1, costEfficiency: 1, reliability: 1 },
  },
  routes: [{ providerId: 'xai', externalModelId: 'grok-test', enabled: true }],
  enabled: false,
};

const imageModel: ModelDefinition = {
  id: 'openai.gpt-image',
  name: 'GPT Image',
  actions: ['image.generate'],
  actionProfiles: {
    'image.generate': { quality: 0.9, speed: 0.4, costEfficiency: 0.5, reliability: 0.85 },
  },
  routes: [{ providerId: 'openai', externalModelId: 'gpt-image-test', enabled: true }],
  enabled: true,
};

const FIXTURE_MODELS = [claude, gpt, disabledModel, imageModel];

function depsWith(overrides: Partial<RouterDependencies> = {}): RouterDependencies {
  return {
    models: FIXTURE_MODELS,
    adapters: adaptersFor('openai', 'anthropic', 'xai', 'openrouter', 'azure-ai-foundry'),
    organizationProviders: orgProvidersWith('openai', 'anthropic', 'openrouter'),
    ...overrides,
  };
}

describe('selectRoute — organization allow-list', () => {
  test('selects only providers enabled for the organization', async () => {
    const decision = await selectRoute(
      { mode: 'auto', organizationId: ORG, actionId: 'core.chat' },
      depsWith({ organizationProviders: orgProvidersWith('openai') }),
    );
    expect(decision.providerId).toBe('openai');
    expect(decision.modelId).toBe('openai.gpt-5');
    expect(decision.fallbacks).toHaveLength(0);
  });

  test('fallbacks contain only enabled providers', async () => {
    const decision = await selectRoute({ mode: 'auto', organizationId: ORG, actionId: 'core.chat' }, depsWith());
    const providersUsed = [decision.providerId, ...decision.fallbacks.map((fallback) => fallback.providerId)];
    for (const providerId of providersUsed) {
      expect(['openai', 'anthropic', 'openrouter']).toContain(providerId);
    }
    expect(providersUsed).not.toContain('xai');
    expect(providersUsed).not.toContain('azure-ai-foundry');
  });

  test('an organization with no providers gets a typed error', async () => {
    expect(
      selectRoute({ mode: 'auto', organizationId: ORG, actionId: 'core.chat' }, depsWith({ organizationProviders: orgProvidersWith() })),
    ).rejects.toBeInstanceOf(NoEligibleRouteError);
  });

  test('the request schema rejects client-supplied provider lists', async () => {
    expect(
      selectRoute(
        {
          mode: 'auto',
          organizationId: ORG,
          actionId: 'core.chat',
          enabledProviders: ['xai'],
        } as never,
        depsWith(),
      ),
    ).rejects.toBeInstanceOf(RouteValidationError);
  });

  test('fixed mode rejects a provider the organization has not enabled, even when its adapter exists', async () => {
    expect(
      selectRoute(
        { mode: 'fixed', organizationId: ORG, actionId: 'core.chat', modelId: 'xai.grok', providerId: 'xai' },
        depsWith({ organizationProviders: orgProvidersWith('openai') }),
      ),
    ).rejects.toBeInstanceOf(ProviderNotEnabledForOrganizationError);
  });
});

describe('selectRoute — eligibility filters', () => {
  test('never selects a disabled model', async () => {
    const decision = await selectRoute(
      { mode: 'auto', organizationId: ORG, actionId: 'core.chat', strategy: 'quality' },
      depsWith({ organizationProviders: orgProvidersWith('openai', 'anthropic', 'xai', 'openrouter') }),
    );
    // disabledModel has perfect scores but is disabled — it must never win.
    expect(decision.modelId).not.toBe('xai.grok');
    expect(decision.fallbacks.map((fallback) => fallback.modelId)).not.toContain('xai.grok');
  });

  test('never selects a disabled route', async () => {
    const decision = await selectRoute(
      { mode: 'auto', organizationId: ORG, actionId: 'core.chat' },
      depsWith({ organizationProviders: orgProvidersWith('openai', 'azure-ai-foundry') }),
    );
    const providersUsed = [decision.providerId, ...decision.fallbacks.map((fallback) => fallback.providerId)];
    expect(providersUsed).not.toContain('azure-ai-foundry');
  });

  test('never selects a model that does not support the action', async () => {
    const decision = await selectRoute({ mode: 'auto', organizationId: ORG, actionId: 'core.reason' }, depsWith());
    expect(decision.modelId).toBe('anthropic.claude-sonnet');
    expect(decision.fallbacks.map((fallback) => fallback.modelId)).not.toContain('openai.gpt-5');
  });

  test('routes without a configured adapter are unavailable', async () => {
    const decision = await selectRoute(
      { mode: 'auto', organizationId: ORG, actionId: 'core.chat' },
      depsWith({ adapters: adaptersFor('anthropic') }),
    );
    expect(decision.providerId).toBe('anthropic');
    expect(decision.fallbacks).toHaveLength(0);
  });

  test('an action nothing supports yields a typed error', async () => {
    expect(
      selectRoute({ mode: 'auto', organizationId: ORG, actionId: 'video.generate' }, depsWith()),
    ).rejects.toBeInstanceOf(NoEligibleRouteError);
  });
});

describe('selectRoute — modes', () => {
  test('model mode stays on the selected model', async () => {
    const decision = await selectRoute(
      { mode: 'model', organizationId: ORG, actionId: 'core.chat', modelId: 'anthropic.claude-sonnet' },
      depsWith(),
    );
    expect(decision.modelId).toBe('anthropic.claude-sonnet');
    for (const fallback of decision.fallbacks) {
      expect(fallback.modelId).toBe('anthropic.claude-sonnet');
    }
    expect(decision.fallbacks).toHaveLength(1);
  });

  test('model mode with a model missing from the registry is a typed error', async () => {
    expect(
      selectRoute(
        { mode: 'model', organizationId: ORG, actionId: 'core.chat', modelId: 'google.gemini-pro' },
        depsWith(),
      ),
    ).rejects.toBeInstanceOf(UnknownModelError);
  });

  test('fixed mode stays on the selected model/provider with no fallbacks by default', async () => {
    const decision = await selectRoute(
      {
        mode: 'fixed',
        organizationId: ORG,
        actionId: 'core.chat',
        modelId: 'anthropic.claude-sonnet',
        providerId: 'openrouter',
      },
      depsWith(),
    );
    expect(decision.modelId).toBe('anthropic.claude-sonnet');
    expect(decision.providerId).toBe('openrouter');
    expect(decision.externalModelId).toBe('anthropic/claude-sonnet-test');
    expect(decision.fallbacks).toHaveLength(0);
  });

  test('fixed mode gains fallbacks only with the explicit allowFallback opt-in', async () => {
    const decision = await selectRoute(
      {
        mode: 'fixed',
        organizationId: ORG,
        actionId: 'core.chat',
        modelId: 'anthropic.claude-sonnet',
        providerId: 'openrouter',
        allowFallback: true,
      },
      depsWith(),
    );
    expect(decision.providerId).toBe('openrouter');
    expect(decision.fallbacks.length).toBeGreaterThan(0);
    for (const fallback of decision.fallbacks) {
      expect(['openai', 'anthropic', 'openrouter']).toContain(fallback.providerId);
    }
  });

  test('rejects malformed requests with a typed validation error', async () => {
    expect(selectRoute({ mode: 'auto', organizationId: '', actionId: 'core.chat' }, depsWith())).rejects.toBeInstanceOf(
      RouteValidationError,
    );
    expect(
      selectRoute({ mode: 'fixed', organizationId: ORG, actionId: 'core.chat', modelId: 'openai.gpt-5', providerId: 'perplexity' } as never, depsWith()),
    ).rejects.toBeInstanceOf(RouteValidationError);
    expect(selectRoute({ mode: 'auto', organizationId: ORG, actionId: 'not.an-action' } as never, depsWith())).rejects.toBeInstanceOf(
      RouteValidationError,
    );
  });
});

describe('selectRoute — determinism and strategies', () => {
  test('auto mode returns identical decisions for identical inputs', async () => {
    const first = await selectRoute({ mode: 'auto', organizationId: ORG, actionId: 'core.chat' }, depsWith());
    const second = await selectRoute({ mode: 'auto', organizationId: ORG, actionId: 'core.chat' }, depsWith());
    expect(second).toEqual(first);
  });

  test('strategy changes the winner deterministically', async () => {
    const quality = await selectRoute(
      { mode: 'auto', organizationId: ORG, actionId: 'core.chat', strategy: 'quality' },
      depsWith(),
    );
    const cost = await selectRoute(
      { mode: 'auto', organizationId: ORG, actionId: 'core.chat', strategy: 'cost' },
      depsWith(),
    );
    expect(quality.modelId).toBe('anthropic.claude-sonnet');
    expect(cost.modelId).toBe('openai.gpt-5');
  });

  test('every strategy weight set sums to 1', () => {
    for (const weights of Object.values(STRATEGY_WEIGHTS)) {
      const sum = weights.quality + weights.speed + weights.costEfficiency + weights.reliability;
      expect(sum).toBeCloseTo(1, 10);
    }
  });

  test('ties break lexicographically by model id then provider id', () => {
    const profile = { quality: 0.5, speed: 0.5, costEfficiency: 0.5, reliability: 0.5 };
    const modelA: ModelDefinition = {
      id: 'anthropic.claude-haiku',
      name: 'A',
      actions: ['core.chat'],
      actionProfiles: { 'core.chat': profile },
      routes: [
        { providerId: 'openrouter', externalModelId: 'a-via-openrouter', enabled: true },
        { providerId: 'anthropic', externalModelId: 'a-via-anthropic', enabled: true },
      ],
      enabled: true,
    };
    const modelB: ModelDefinition = {
      id: 'openai.gpt-5-mini',
      name: 'B',
      actions: ['core.chat'],
      actionProfiles: { 'core.chat': profile },
      routes: [{ providerId: 'openai', externalModelId: 'b-via-openai', enabled: true }],
      enabled: true,
    };
    const candidates: RouteCandidate[] = [modelB, modelA].flatMap((model) =>
      model.routes.map((route) => ({ actionId: 'core.chat' as const, model, route, profile })),
    );
    const ranked = rankCandidates(candidates, 'balanced');
    expect(ranked.map((candidate) => `${candidate.model.id}/${candidate.route.providerId}`)).toEqual([
      'anthropic.claude-haiku/anthropic',
      'anthropic.claude-haiku/openrouter',
      'openai.gpt-5-mini/openai',
    ]);
    // All scores identical — ordering is purely the deterministic tie-break.
    const scores = ranked.map((candidate) => scoreCandidate(candidate, 'balanced'));
    expect(new Set(scores).size).toBe(1);
    expect(compareCandidates(ranked[0]!, ranked[0]!, 'balanced')).toBe(0);
  });
});
