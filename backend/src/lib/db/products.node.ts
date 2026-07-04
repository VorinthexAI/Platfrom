import { z } from 'zod';
import { aql } from 'arangojs';
import { db } from './client';
import { createNodeHelpers, withArangoKey } from './base';

export const PRODUCTS_COLLECTION = 'products';

export const productSchema = z.object({
  key: z.string(),
  productId: z.string(),
  name: z.string(),
  type: z.enum(['subscription', 'one_time']),
  priceCents: z.number().int().min(0),
  billingPeriod: z.string().nullable().default(null),
  gracePeriod: z.number().int().nullable().default(null),
  polarProductId: z.string().nullable().default(null),
  createdAt: z.string(),
  updatedAt: z.string(),
  embedding: z.array(z.number()).default([]),
});

export type Product = z.infer<typeof productSchema>;

// priceCents/gracePeriod are numeric filters, not search text; polarProductId is an
// opaque external id.
export const productsEmbedKeys = z.enum(['productId', 'name', 'type', 'billingPeriod']);

const helpers = createNodeHelpers(PRODUCTS_COLLECTION, productSchema, productsEmbedKeys.options);

export const insertProduct = helpers.insert;
export const getProductById = helpers.getById;
export const updateProduct = helpers.updateById;
export const deleteProduct = helpers.deleteById;
export const upsertProduct = helpers.upsertByKey;
export const getAllProductsChunked = helpers.getAllChunked;
export const listProductsPage = helpers.listPage;

export async function getProductByProductId(productId: string): Promise<Product | null> {
  const cursor = await db.query(aql`
    FOR p IN ${db.collection(PRODUCTS_COLLECTION)}
      FILTER p.productId == ${productId}
      LIMIT 1
      RETURN p
  `);
  const doc = await cursor.next();
  return doc ? productSchema.parse(withArangoKey(doc)) : null;
}

export async function getProductByPolarProductId(polarProductId: string): Promise<Product | null> {
  const cursor = await db.query(aql`
    FOR p IN ${db.collection(PRODUCTS_COLLECTION)}
      FILTER p.polarProductId == ${polarProductId}
      LIMIT 1
      RETURN p
  `);
  const doc = await cursor.next();
  return doc ? productSchema.parse(withArangoKey(doc)) : null;
}

export async function listAllProducts(): Promise<Product[]> {
  const cursor = await db.query(aql`
    FOR p IN ${db.collection(PRODUCTS_COLLECTION)}
      SORT p.priceCents ASC, p.productId ASC
      RETURN p
  `);
  const docs = await cursor.all();
  return docs.map((doc) => productSchema.parse(withArangoKey(doc)));
}
