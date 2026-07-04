import type { Context } from 'hono';
import { z } from 'zod';

export const strictObject = <Shape extends z.ZodRawShape>(shape: Shape) => z.object(shape).strict();

export const emptyObject = strictObject({});

export async function parseJson<Schema extends z.ZodTypeAny>(c: Context, schema: Schema): Promise<z.infer<Schema>> {
  return schema.parse(await c.req.json());
}

export function parseQuery<Schema extends z.ZodTypeAny>(c: Context, schema: Schema): z.infer<Schema> {
  return schema.parse(c.req.query());
}
