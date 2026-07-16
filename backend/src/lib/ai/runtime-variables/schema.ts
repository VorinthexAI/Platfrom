import { z } from 'zod';

export const RUNTIME_VARIABLES_COLLECTION = 'runtimeVariables';
export type RuntimeVariableValue = string | number | boolean | null | RuntimeVariableValue[] | { [key: string]: RuntimeVariableValue };
export const runtimeVariableValueSchema: z.ZodType<RuntimeVariableValue> = z.lazy(() => z.union([
  z.string(), z.number().finite(), z.boolean(), z.null(), z.array(runtimeVariableValueSchema), z.record(runtimeVariableValueSchema),
]));

export const runtimeVariableSchema = z.object({
  key: z.string().cuid(),
  organizationKey: z.string().cuid(),
  scopeKey: z.string().cuid().nullable(),
  agentKey: z.string().cuid().nullable(),
  name: z.string().trim().min(1).max(160).regex(/^[A-Za-z][A-Za-z0-9_.-]*$/),
  value: runtimeVariableValueSchema,
}).strict();

export type RuntimeVariable = z.infer<typeof runtimeVariableSchema>;
