import type { Database } from 'arangojs';
import { ACTION_DEFINITIONS } from '@/lib/ai/actions';
import { PROVIDER_SLUGS } from '@/lib/ai/providers/types';

export const RETAINED_MODEL_SLUGS = [
  'openai.gpt-5.6-luna',
  'openai.gpt-image-2',
  'bfl.flux-2-klein-4b',
  'xai.grok-imagine-image-quality',
  'openai.text-embedding-3-small',
  'google.gemini-2.5-flash-lite',
] as const;

export const RETAINED_PROVIDER_SLUGS = PROVIDER_SLUGS;
export const RETAINED_MODEL_ACTION_BINDINGS = ACTION_DEFINITIONS.flatMap(({ id, models }) => models.map(({ model }) => `${model}:${id}`));
export const RETAINED_MODEL_PROVIDER_BINDINGS = [
  'openai.gpt-5.6-luna:openai:gpt-5.6-luna',
  'openai.gpt-image-2:openai:gpt-image-2',
  'bfl.flux-2-klein-4b:openrouter:black-forest-labs/flux.2-klein-4b',
  'xai.grok-imagine-image-quality:openrouter:x-ai/grok-imagine-image-quality',
  'openai.text-embedding-3-small:openai:text-embedding-3-small',
  'google.gemini-2.5-flash-lite:openrouter:google/gemini-2.5-flash-lite',
] as const;

/** Hard-delete retired runtime configuration without rewriting historical usage. */
export async function retireAiPersistence(targetDb: Database): Promise<void> {
  await targetDb.query(`
    FOR relation IN modelActions
      LET model = DOCUMENT(models, relation.modelKey)
      FILTER model == null || CONCAT(model.slug, ":", relation.actionSlug) NOT IN @retainedModelActionBindings
      REMOVE relation IN modelActions
  `, { retainedModelActionBindings: RETAINED_MODEL_ACTION_BINDINGS });
  await targetDb.query(`
    FOR relation IN modelProviders
      LET model = DOCUMENT(models, relation.modelKey)
      LET provider = DOCUMENT(providers, relation.providerKey)
      FILTER model == null || provider == null || CONCAT(model.slug, ":", provider.slug, ":", relation.providerModelId) NOT IN @retainedModelProviderBindings
      REMOVE relation IN modelProviders
  `, { retainedModelProviderBindings: RETAINED_MODEL_PROVIDER_BINDINGS });
  for (const collection of ['organizationProviders', 'orgCredentials']) {
    await targetDb.query(`
      LET retainedProviderKeys = (
        FOR provider IN providers
          FILTER provider.slug IN @retainedProviderSlugs
          RETURN provider._key
      )
      FOR relation IN @@collection
        FILTER relation.providerKey NOT IN retainedProviderKeys
        REMOVE relation IN @@collection
    `, { '@collection': collection, retainedProviderSlugs: RETAINED_PROVIDER_SLUGS });
  }
  await targetDb.query('FOR model IN models FILTER model.slug NOT IN @retainedModelSlugs REMOVE model IN models', { retainedModelSlugs: RETAINED_MODEL_SLUGS });
  await targetDb.query(`
    FOR provider IN providers
      FILTER provider.slug NOT IN @retainedProviderSlugs
      REMOVE provider IN providers
  `, { retainedProviderSlugs: RETAINED_PROVIDER_SLUGS });
}
