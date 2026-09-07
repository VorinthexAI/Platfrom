import type { CommerceRepository } from './repository';
import { activeExclusiveFixedUsdPrice, type PolarProduct, type PolarProvider } from './polar';

export async function synchronizeCommerceProducts(repository: CommerceRepository, provider: PolarProvider, now = () => new Date()) {
  const localProducts = await repository.listProducts(false);
  const remoteProducts = await provider.listProducts();
  const remoteById = new Map(remoteProducts.map((product) => [product.id, product]));
  const remoteByProductId = new Map<string, PolarProduct>();
  for (const remote of remoteProducts) {
    const productId = remote.metadata.productId;
    if (typeof productId !== 'string') continue;
    if (remoteByProductId.has(productId)) throw new Error(`Polar catalog contains duplicate product metadata for ${productId}.`);
    remoteByProductId.set(productId, remote);
  }

  for (const product of localProducts) {
    const matched = product.providerProductId ? remoteById.get(product.providerProductId) : remoteByProductId.get(product.productId);
    if (!matched) {
      if (!product.active || product.providerProductId) continue;
      const created = await provider.createProduct({ name: product.productId, productId: product.productId, priceCents: product.discountedPriceCents ?? product.priceCents, billingPeriod: product.billingPeriod });
      await repository.updateProductProviderId(product.key, created.id, now().toISOString());
      continue;
    }
    if (matched.metadata.productId !== product.productId) throw new Error(`Polar product ${matched.id} does not match local product ${product.productId}.`);
    if (matched.recurring_interval !== product.billingPeriod) throw new Error(`Polar product ${matched.id} has an incompatible recurring interval.`);
    if (product.providerProductId !== matched.id) await repository.updateProductProviderId(product.key, matched.id, now().toISOString());

    const desiredPrice = product.discountedPriceCents ?? product.priceCents;
    const currentPrice = activeExclusiveFixedUsdPrice(matched, desiredPrice);
    const update = {
      ...(matched.name === product.productId ? {} : { name: product.productId }),
      ...(matched.is_archived === !product.active ? {} : { archived: !product.active }),
      ...(!product.active || currentPrice ? {} : { priceCents: desiredPrice }),
    };
    if (Object.keys(update).length > 0) await provider.updateProduct(matched.id, update);
  }
}
