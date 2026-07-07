import { z } from 'zod';
import { aql } from 'arangojs';
import { db } from './client';
import { createNodeHelpers, withArangoKey } from './base';

export const OUTPUT_ANALYTICS_COLLECTION = 'outputAnalytics';

export const outputAnalyticsSchema = z.object({
  key: z.string(),
  outputId: z.string(),
  views: z.number().int().nullable().default(null),
  engagementRate: z.number().nullable().default(null),
  snapshotAt: z.string(),
  embedding: z.array(z.number()).default([]),
});

export type OutputAnalytics = z.infer<typeof outputAnalyticsSchema>;

// Time-series metrics (views/engagementRate) are query/sort/filter fields, not
// descriptive search text — never embedded.
const helpers = createNodeHelpers(OUTPUT_ANALYTICS_COLLECTION, outputAnalyticsSchema);

export const insertOutputAnalytics = helpers.insert;
export const getOutputAnalyticsById = helpers.getById;
export const deleteOutputAnalytics = helpers.deleteById;
export const upsertOutputAnalyticsByKey = helpers.upsertByKey;
export const getAllOutputAnalyticsChunked = helpers.getAllChunked;
export const listOutputAnalyticsPage = helpers.listPage;

export async function listAnalyticsByOutputId(outputId: string): Promise<OutputAnalytics[]> {
  const cursor = await db.query(aql`
    FOR a IN ${db.collection(OUTPUT_ANALYTICS_COLLECTION)}
      FILTER a.outputId == ${outputId}
      SORT a.snapshotAt DESC
      RETURN a
  `);
  const docs = await cursor.all();
  return docs.map((doc) => outputAnalyticsSchema.parse(withArangoKey(doc)));
}
