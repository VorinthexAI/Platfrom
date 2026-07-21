import { describe, expect, test } from 'bun:test';
import { createStaticProviderAdapter, isStaticProviderRoute, STATIC_PROVIDER_ROUTES } from './static-routes';

const staticEmbedRoute = {
  actionSlug: 'embed',
  modelSlug: 'amazon.titan-embed-text-v2',
  providerSlug: 'aws-bedrock' as const,
};

describe('static provider routes', () => {
  test('registers only the Bedrock Titan embed route', () => {
    expect(STATIC_PROVIDER_ROUTES).toEqual([staticEmbedRoute]);
    expect(isStaticProviderRoute(staticEmbedRoute)).toBe(true);
    expect(isStaticProviderRoute({ ...staticEmbedRoute, actionSlug: 'reason' })).toBe(false);
  });

  test('does not create an adapter for a non-static route', () => {
    expect(createStaticProviderAdapter({ ...staticEmbedRoute, actionSlug: 'reason' })).toBeUndefined();
  });
});
