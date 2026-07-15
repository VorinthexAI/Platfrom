import { z } from 'zod';

export const AGENT_RUNS_COLLECTION = 'agentRuns';
export const AGENT_RUN_STATUSES = ['accepted', 'rejected'] as const;
export const AGENT_RUN_STEP_STATUSES = ['completed', 'failed', 'skipped'] as const;

export type AgentRunStatus = (typeof AGENT_RUN_STATUSES)[number];
export type AgentRunStepStatus = (typeof AGENT_RUN_STEP_STATUSES)[number];

const cuidSchema = z.string().cuid2();
const tokenCountSchema = z.number().int().nonnegative();

export const maxTenWordsSchema = z
  .string()
  .trim()
  .min(1)
  .refine((value) => value.split(/\s+/).length <= 10, 'Reason must contain at most ten words');

export const agentRunCallSchema = z
  .object({
    callId: cuidSchema,
    stepId: z.string().trim().min(1),
    skillKey: cuidSchema,
    toolKey: cuidSchema.nullable(),
    actionKey: cuidSchema,
    modelKey: cuidSchema,
    providerKey: cuidSchema,
    inputTokens: tokenCountSchema,
    outputTokens: tokenCountSchema,
    totalTokens: tokenCountSchema,
    startedAt: z.string().datetime(),
    endedAt: z.string().datetime(),
    elapsedMs: tokenCountSchema,
  })
  .superRefine((call, ctx) => {
    if (call.totalTokens !== call.inputTokens + call.outputTokens) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['totalTokens'],
        message: 'totalTokens must equal inputTokens plus outputTokens',
      });
    }
  });

export type AgentRunCall = z.infer<typeof agentRunCallSchema>;

export const agentRunStepSchema = z
  .object({
    stepId: z.string().trim().min(1),
    status: z.enum(AGENT_RUN_STEP_STATUSES),
    skillKeys: z.array(cuidSchema),
    callIds: z.array(cuidSchema),
    inputTokens: tokenCountSchema,
    outputTokens: tokenCountSchema,
    totalTokens: tokenCountSchema,
    startedAt: z.string().datetime(),
    endedAt: z.string().datetime(),
    elapsedMs: tokenCountSchema,
  })
  .superRefine((step, ctx) => {
    if (step.totalTokens !== step.inputTokens + step.outputTokens) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['totalTokens'],
        message: 'totalTokens must equal inputTokens plus outputTokens',
      });
    }
  });

export type AgentRunStep = z.infer<typeof agentRunStepSchema>;

function sameValues(actual: readonly string[], expected: readonly string[]) {
  return actual.length === expected.length && actual.every((value, index) => value === expected[index]);
}

function unique(values: readonly string[]) {
  return [...new Set(values)];
}

export const agentRunSchema = z
  .object({
    key: cuidSchema,
    organizationKey: cuidSchema,
    scopeKey: cuidSchema,
    agentKey: cuidSchema,
    status: z.enum(AGENT_RUN_STATUSES),
    reason: maxTenWordsSchema,
    score: z.number().min(0).max(1),
    inputTokens: tokenCountSchema,
    outputTokens: tokenCountSchema,
    totalTokens: tokenCountSchema,
    startedAt: z.string().datetime(),
    endedAt: z.string().datetime(),
    elapsedMs: tokenCountSchema,
    stepsCount: tokenCountSchema,
    steps: z.array(agentRunStepSchema),
    callsCount: tokenCountSchema,
    calls: z.array(agentRunCallSchema),
    skillKeys: z.array(cuidSchema),
    toolKeys: z.array(cuidSchema),
    actionKeys: z.array(cuidSchema),
    modelKeys: z.array(cuidSchema),
    providerKeys: z.array(cuidSchema),
    createdAt: z.string().datetime(),
  })
  .superRefine((run, ctx) => {
    const issue = (path: string, message: string) => ctx.addIssue({ code: z.ZodIssueCode.custom, path: [path], message });
    if (run.stepsCount !== run.steps.length) issue('stepsCount', 'stepsCount must equal steps length');
    if (run.callsCount !== run.calls.length) issue('callsCount', 'callsCount must equal calls length');

    const inputTokens = run.calls.reduce((sum, call) => sum + call.inputTokens, 0);
    const outputTokens = run.calls.reduce((sum, call) => sum + call.outputTokens, 0);
    const totalTokens = run.calls.reduce((sum, call) => sum + call.totalTokens, 0);
    if (run.inputTokens !== inputTokens) issue('inputTokens', 'inputTokens must equal the sum of all calls');
    if (run.outputTokens !== outputTokens) issue('outputTokens', 'outputTokens must equal the sum of all calls');
    if (run.totalTokens !== totalTokens) issue('totalTokens', 'totalTokens must equal the sum of all calls');

    if (unique(run.steps.map((step) => step.stepId)).length !== run.steps.length) issue('steps', 'stepId values must be unique');
    if (unique(run.calls.map((call) => call.callId)).length !== run.calls.length) issue('calls', 'callId values must be unique');

    for (const step of run.steps) {
      const calls = run.calls.filter((call) => call.stepId === step.stepId);
      if (!sameValues(step.callIds, calls.map((call) => call.callId))) issue('steps', `callIds must match calls for step ${step.stepId}`);
      if (step.inputTokens !== calls.reduce((sum, call) => sum + call.inputTokens, 0)) issue('steps', `inputTokens must match calls for step ${step.stepId}`);
      if (step.outputTokens !== calls.reduce((sum, call) => sum + call.outputTokens, 0)) issue('steps', `outputTokens must match calls for step ${step.stepId}`);
      if (step.totalTokens !== calls.reduce((sum, call) => sum + call.totalTokens, 0)) issue('steps', `totalTokens must match calls for step ${step.stepId}`);
    }
    if (run.calls.some((call) => !run.steps.some((step) => step.stepId === call.stepId))) issue('calls', 'every call must belong to a step');

    const expectedSkillKeys = unique([...run.steps.flatMap((step) => step.skillKeys), ...run.calls.map((call) => call.skillKey)]);
    const expectedToolKeys = unique(run.calls.flatMap((call) => call.toolKey ? [call.toolKey] : []));
    const expectedActionKeys = unique(run.calls.map((call) => call.actionKey));
    const expectedModelKeys = unique(run.calls.map((call) => call.modelKey));
    const expectedProviderKeys = unique(run.calls.map((call) => call.providerKey));
    if (!sameValues(run.skillKeys, expectedSkillKeys)) issue('skillKeys', 'skillKeys must be derived from steps and calls');
    if (!sameValues(run.toolKeys, expectedToolKeys)) issue('toolKeys', 'toolKeys must be derived from calls');
    if (!sameValues(run.actionKeys, expectedActionKeys)) issue('actionKeys', 'actionKeys must be derived from calls');
    if (!sameValues(run.modelKeys, expectedModelKeys)) issue('modelKeys', 'modelKeys must be derived from calls');
    if (!sameValues(run.providerKeys, expectedProviderKeys)) issue('providerKeys', 'providerKeys must be derived from calls');
  });

export type AgentRun = z.infer<typeof agentRunSchema>;
