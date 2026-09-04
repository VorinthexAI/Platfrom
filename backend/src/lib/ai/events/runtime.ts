import { AsyncLocalStorage } from 'node:async_hooks';
import type { TokenUsage } from '@/lib/ai/shared/usage';
import type { ToolContext } from '@/lib/ai/tools/tool-context';
import { APP_KEYS } from '@/lib/apps/registry';
import { appKeySchema } from '@/lib/db/apps.node';
import { calculateActionCostMicroSparks, calculateFixedCost, lookupCostRule, lookupToolCostPolicy } from '@/lib/costs';
import { sha256 } from '@/lib/crypto';
import { newId } from '@/lib/ids';
import { sparkService } from '@/lib/sparks/service';
import { SparkRepositoryError, type ApplySparkResult } from '@/lib/sparks/repository';
import { toolEventService, type ToolEventInput, type ToolEventRecorder } from './service';

export const TOOL_APP_KEY_HEADER = 'X-Vorinthex-App-Key';

export interface ToolBillingDependencies {
  charge?: typeof sparkService.chargeExecution;
  refund?: typeof sparkService.refund;
  complete?: typeof sparkService.completeExecution;
  renew?: typeof sparkService.renewExecution;
  getBalance?: typeof sparkService.getBalance;
  id?: () => string;
  hash?: typeof sha256;
}

interface MutableUsage extends TokenUsage { observed: boolean }
interface ActionUsage { slug: string; input: unknown; usage: TokenUsage }
interface CostContext {
  toolSlug: string;
  actionUsage: ActionUsage[];
  userKey: string | null;
  idempotencyKey?: string;
  billingMode: 'fixed' | 'outcome' | 'action' | 'free';
  lookupCost: typeof lookupCostRule;
  recorderAvailable: boolean;
  executionIdentity?: string;
  hash: typeof sha256;
  charge: typeof sparkService.chargeExecution;
  complete: typeof sparkService.completeExecution;
  renew: typeof sparkService.renewExecution;
  getBalance: typeof sparkService.getBalance;
  actionSequence: number;
  actionPreflighted: boolean;
  actionCharges: Array<{ amount: number; executionIdentity: string; result: ApplySparkResult; accepted: boolean }>;
  actionLeaseTimer?: ReturnType<typeof setInterval>;
  actionLeaseRenewal: Promise<boolean>;
  eventKey?: string;
  fixedChargeReceipt?: FixedChargeReceipt;
  fixedOutcomeAccepted: boolean;
}
interface EventRuntimeContext { appKey: string; recorder: ToolEventRecorder; usage?: MutableUsage; cost?: CostContext }

const storage = new AsyncLocalStorage<EventRuntimeContext>();
const USAGE_PRICED_ACTIONS = new Set(['text', 'image', 'speech']);

export class SparkRefundError extends Error {
  constructor(public readonly executionError: unknown, options: { cause: unknown }) {
    super('Spark charge refund failed after execution failure.', options);
    this.name = 'SparkRefundError';
  }
}

export class SparkExecutionPendingError extends Error {
  constructor(public readonly transactionKey: string) {
    super('A matching priced execution is already in progress.');
    this.name = 'SparkExecutionPendingError';
  }
}

export function currentEventAppKey(): string { return storage.getStore()?.appKey ?? APP_KEYS.CORE }
export function currentBillingUserKey(): string | null { return storage.getStore()?.cost?.userKey ?? null }
export interface FixedChargeReceipt { userKey: string; toolSlug: string; microSparks: number; transactionKey: string; executionIdentity: string; replayed: boolean }
export function currentFixedChargeReceipt(toolSlug?: string): FixedChargeReceipt | null {
  const receipt = storage.getStore()?.cost?.fixedChargeReceipt;
  return receipt && (!toolSlug || receipt.toolSlug === toolSlug) ? receipt : null;
}
export function markFixedChargeOutcomeAccepted(toolSlug?: string) {
  const cost = storage.getStore()?.cost;
  if (!cost?.fixedChargeReceipt || toolSlug && cost.fixedChargeReceipt.toolSlug !== toolSlug) throw new Error('A matching fixed Spark charge is not active.');
  cost.fixedOutcomeAccepted = true;
}
export function runWithEventApp<T>(appKey: string, execute: () => T, recorder: ToolEventRecorder = toolEventService.record) {
  return storage.run({ appKey: appKeySchema.parse(appKey), recorder }, execute);
}

export function addToolTokenUsage(usage: TokenUsage) {
  const active = storage.getStore()?.usage;
  if (!active) return;
  active.observed = true;
  active.inputTokens += usage.inputTokens;
  active.outputTokens += usage.outputTokens;
  active.totalTokens += usage.totalTokens;
}

/** Called before provider work to enforce the stable identity requirement. */
export async function recordActionCost(actionSlug: string, _input?: unknown) {
  const active = storage.getStore()?.cost;
  if (!active || !active.userKey || active.billingMode !== 'action') return;
  const priced = USAGE_PRICED_ACTIONS.has(actionSlug) || Boolean(active.lookupCost({ actionSlug }));
  if (priced && !active.idempotencyKey) throw new Error(`Priced action ${actionSlug} requires a stable request key.`);
  if (priced && !active.recorderAvailable) throw new Error(`Priced action ${actionSlug} requires an analytics recorder.`);
  if (priced && !active.actionPreflighted) {
    const balance = await active.getBalance(active.userKey);
    if (balance === null) throw new SparkRepositoryError('USER_NOT_FOUND', 'Spark account user was not found.');
    if (balance <= 0) throw new SparkRepositoryError('INSUFFICIENT_BALANCE', 'Spark balance is insufficient for this execution.');
    active.actionPreflighted = true;
  }
}

/** Records one successful action's own usage, never an enclosing aggregate. */
export async function recordActionUsage(actionSlug: string, input: unknown, usage: TokenUsage) {
  const active = storage.getStore()?.cost;
  if (!active || active.billingMode !== 'action') return;
  active.actionUsage.push({ slug: actionSlug, input, usage });
  if (!active.userKey || !active.executionIdentity) return;
  const fixed = active.lookupCost({ actionSlug });
  const amount = fixed ? calculateFixedCost(fixed.rule, input) : calculateActionCostMicroSparks(actionSlug, usage, input);
  if (amount === 0) return;
  const sequence = active.actionSequence++;
  const actionIdentity = await active.hash(JSON.stringify({ executionIdentity: active.executionIdentity, actionSlug, sequence, input }));
  const result = await active.charge(active.userKey, {
    kind: 'action', actionSlug, microSparks: amount,
    idempotencyKey: `execution:${actionIdentity}`,
    executionIdentity: actionIdentity,
    requestHash: await active.hash(JSON.stringify({ toolSlug: active.toolSlug, actionSlug, sequence, input })),
    eventKey: active.eventKey,
    metadata: { inputTokens: usage.inputTokens, outputTokens: usage.outputTokens, totalTokens: usage.totalTokens, amountMicroSparks: amount },
  });
  if (result.status === 'conflict') throw new Error(`Spark action charge conflicted for ${actionSlug}.`);
  if (result.status === 'pending') throw new SparkExecutionPendingError(result.transaction.key);
  active.actionCharges.push({ amount, executionIdentity: actionIdentity, result, accepted: false });
  startActionLeaseRenewal(active);
}

/** Charges one fixed-price unit after canonical code has established a cache miss. */
export async function chargeToolOutcome(outcomeKey: string, input?: unknown): Promise<string | null> {
  const active = storage.getStore()?.cost;
  if (!active || !active.userKey || active.billingMode !== 'outcome') return null;
  if (!active.executionIdentity) throw new Error(`Priced outcome for ${active.toolSlug} requires a stable request key.`);
  if (!active.recorderAvailable) throw new Error(`Priced outcome for ${active.toolSlug} requires an analytics recorder.`);
  const policy = lookupToolCostPolicy(active.toolSlug);
  if (!policy || policy.mode !== 'outcome') throw new Error(`Tool ${active.toolSlug} does not have outcome-based pricing.`);
  const amount = calculateFixedCost(policy.rule, input);
  const outcomeIdentity = await active.hash(JSON.stringify({ executionIdentity: active.executionIdentity, toolSlug: active.toolSlug, outcomeKey }));
  const result = await active.charge(active.userKey, {
    kind: 'tool', toolSlug: active.toolSlug, microSparks: amount,
    idempotencyKey: `execution:${outcomeIdentity}`,
    executionIdentity: outcomeIdentity,
    requestHash: await active.hash(JSON.stringify({ toolSlug: active.toolSlug, outcomeKey, input: input ?? null, microSparks: amount })),
    eventKey: active.eventKey,
    metadata: { paidOutcome: policy.paidOutcome },
  });
  if (result.status === 'conflict') throw new Error(`Spark outcome charge conflicted for ${active.toolSlug}.`);
  if (result.status === 'pending') throw new SparkExecutionPendingError(result.transaction.key);
  active.actionCharges.push({ amount, executionIdentity: outcomeIdentity, result, accepted: false });
  startActionLeaseRenewal(active);
  return outcomeIdentity;
}

export async function markToolOutcomeAccepted(executionIdentity: string) {
  const cost = storage.getStore()?.cost;
  if (!cost || cost.billingMode !== 'outcome' || !cost.userKey) throw new Error('An outcome-priced Spark execution is not active.');
  const item = cost.actionCharges.find((candidate) => candidate.executionIdentity === executionIdentity);
  if (!item) throw new Error('The Spark outcome charge does not belong to this execution.');
  if (item.accepted) return;
  if (item.result.status === 'applied' && item.result.claimOwner && !await cost.complete(cost.userKey, item.executionIdentity, item.result.claimOwner)) throw new Error(`Spark outcome execution lease was lost for ${cost.toolSlug}.`);
  item.accepted = true;
}

function startActionLeaseRenewal(cost: CostContext) {
  if (cost.actionLeaseTimer || !cost.actionCharges.some(({ result }) => result.status === 'applied' && result.claimOwner)) return;
  cost.actionLeaseTimer = setInterval(() => {
    cost.actionLeaseRenewal = cost.actionLeaseRenewal.then(async (healthy) => healthy && (await Promise.all(cost.actionCharges.map(({ executionIdentity, result, accepted }) => !accepted && result.status === 'applied' && result.claimOwner ? cost.renew(cost.userKey!, executionIdentity, result.claimOwner) : true))).every(Boolean)).catch(() => false);
  }, 60_000);
  cost.actionLeaseTimer.unref?.();
}

function actor(context: ToolContext): Pick<ToolEventInput, 'userId' | 'scopeKey'> {
  return { userId: context.principal.kind === 'member' ? context.principal.user.key : null, scopeKey: context.runtimeScopeKey };
}

export async function observeToolExecution<T>(
  slug: string,
  context: ToolContext,
  execute: () => Promise<T>,
  options: {
    appKey?: string;
    recorder?: ToolEventRecorder;
    idempotencyKey?: string;
    input?: unknown;
    lookupCost?: typeof lookupCostRule;
    charge?: ToolBillingDependencies['charge'];
    refund?: ToolBillingDependencies['refund'];
    complete?: ToolBillingDependencies['complete'];
    renew?: ToolBillingDependencies['renew'];
    getBalance?: ToolBillingDependencies['getBalance'];
    id?: ToolBillingDependencies['id'];
    hash?: ToolBillingDependencies['hash'];
  } = {},
): Promise<T> {
  const parent = storage.getStore();
  const recorder = options.recorder ?? parent?.recorder;
  const appKey = appKeySchema.parse(options.appKey ?? parent?.appKey ?? APP_KEYS.CORE);
  const usage: MutableUsage = { inputTokens: 0, outputTokens: 0, totalTokens: 0, observed: false };
  const userKey = context.principal.kind === 'member' ? context.principal.user.key : null;
  const lookup = options.lookupCost ?? lookupCostRule;
  const idempotencyKey = options.idempotencyKey;
  if (idempotencyKey !== undefined && (idempotencyKey.trim() !== idempotencyKey || idempotencyKey.length < 1 || idempotencyKey.length > 256)) throw new Error('Execution request key must be a trimmed string between 1 and 256 characters.');
  const injectedToolRule = options.lookupCost ? lookup({ toolSlug: slug }) : null;
  const policy = options.lookupCost
    ? injectedToolRule ? { mode: 'fixed' as const, rule: injectedToolRule.rule, paidOutcome: 'operation-completed' as const } : { mode: 'action' as const }
    : lookupToolCostPolicy(slug, options.input) ?? { mode: 'free' as const };
  const toolMicroSparks = policy.mode === 'fixed' ? calculateFixedCost(policy.rule, options.input) : 0;
  if (userKey && toolMicroSparks > 0 && !idempotencyKey) throw new Error(`Priced tool ${slug} requires a stable request key.`);
  if (userKey && toolMicroSparks > 0 && !recorder) throw new Error(`Priced tool ${slug} requires an analytics recorder.`);

  const hash = options.hash ?? sha256;
  const executionIdentity = idempotencyKey ? await hash(JSON.stringify({ requestKey: idempotencyKey, toolSlug: slug })) : undefined;
  const charge = options.charge ?? sparkService.chargeExecution;
  const complete = options.complete ?? sparkService.completeExecution;
  const getBalance = options.getBalance ?? (options.charge ? async () => Number.MAX_SAFE_INTEGER : sparkService.getBalance);
  let eventKey: string | undefined;
  if (userKey && recorder && (policy.mode === 'action' || policy.mode === 'outcome')) eventKey = (options.id ?? newId)();
  const cost: CostContext = {
    toolSlug: slug, actionUsage: [], userKey, idempotencyKey, billingMode: policy.mode, lookupCost: lookup,
    recorderAvailable: Boolean(recorder), executionIdentity, hash, charge, complete, renew: options.renew ?? sparkService.renewExecution, getBalance,
    actionSequence: 0, actionPreflighted: false, actionCharges: [], actionLeaseRenewal: Promise.resolve(true), eventKey, fixedOutcomeAccepted: false,
  };
  const ledgerKey = executionIdentity ? `execution:${executionIdentity}` : undefined;
  let sparkTransactionKey: string | null = null;
  let chargedAmount = 0;
  let precharge: Awaited<ReturnType<typeof sparkService.chargeExecution>> | null = null;
  let status: 'completed' | 'failed' = 'failed';
  let result: T | undefined;
  let executionError: unknown;
  let leaseTimer: ReturnType<typeof setInterval> | undefined;
  let leaseRenewal = Promise.resolve(true);

  try {
    if (userKey && toolMicroSparks > 0) {
      eventKey = (options.id ?? newId)();
      precharge = await charge(userKey, {
        kind: 'tool', toolSlug: slug, microSparks: toolMicroSparks, idempotencyKey: ledgerKey!, executionIdentity: executionIdentity!,
        requestHash: await hash(JSON.stringify({ toolSlug: slug, input: options.input ?? null, microSparks: toolMicroSparks })), eventKey,
        metadata: { paidOutcome: policy.mode === 'fixed' ? policy.paidOutcome : 'operation-completed' },
      });
      if (precharge.status === 'conflict') throw new Error(`Spark charge conflicted for ${slug}.`);
      if (precharge.status === 'pending') throw new SparkExecutionPendingError(precharge.transaction.key);
      chargedAmount = toolMicroSparks;
      sparkTransactionKey = precharge.transaction.key;
      cost.fixedChargeReceipt = { userKey, toolSlug: slug, microSparks: toolMicroSparks, transactionKey: precharge.transaction.key, executionIdentity: executionIdentity!, replayed: precharge.status === 'replayed' };
      eventKey = precharge.transaction.eventKey;
      if (!eventKey) throw new Error(`Spark charge for ${slug} did not retain an analytics event key.`);
      if (precharge.status === 'applied' && precharge.claimOwner) {
        const renew = options.renew ?? sparkService.renewExecution;
        const claimOwner = precharge.claimOwner;
        leaseTimer = setInterval(() => { leaseRenewal = leaseRenewal.then((healthy) => healthy && renew(userKey, executionIdentity!, claimOwner)).catch(() => false); }, 60_000);
        leaseTimer.unref?.();
      }
    }
    result = await storage.run({ appKey, recorder: recorder ?? toolEventService.record, usage, cost }, execute);
    if (userKey && toolMicroSparks && precharge?.status === 'applied' && precharge.claimOwner) {
      if (leaseTimer) clearInterval(leaseTimer);
      if (!await leaseRenewal) throw new Error(`Spark execution lease renewal failed for ${slug}.`);
      if (!await complete(userKey, executionIdentity!, precharge.claimOwner)) throw new Error(`Spark execution lease was lost for ${slug}.`);
    }
    if (userKey && cost.actionCharges.length) {
      if (cost.actionLeaseTimer) clearInterval(cost.actionLeaseTimer);
      if (!await cost.actionLeaseRenewal) throw new Error(`Spark action execution lease renewal failed for ${slug}.`);
      for (const item of cost.actionCharges) {
        if (!item.accepted && item.result.status === 'applied' && item.result.claimOwner && !await complete(userKey, item.executionIdentity, item.result.claimOwner)) throw new Error(`Spark action execution lease was lost for ${slug}.`);
      }
      chargedAmount = cost.actionCharges.reduce((sum, item) => sum + item.amount, 0);
      if (cost.actionCharges.length === 1) sparkTransactionKey = cost.actionCharges[0]!.result.transaction.key;
    }
    status = 'completed';
  } catch (error) {
    if (leaseTimer) clearInterval(leaseTimer);
    if (cost.actionLeaseTimer) clearInterval(cost.actionLeaseTimer);
    executionError = error;
    if (userKey && precharge?.status === 'applied' && cost.fixedOutcomeAccepted && precharge.claimOwner) {
      if (!await leaseRenewal || !await complete(userKey, executionIdentity!, precharge.claimOwner)) executionError = new Error(`Spark execution lease was lost after durable acceptance for ${slug}.`, { cause: error });
    } else if (userKey && precharge?.status === 'applied') {
      try {
        const refunded = await (options.refund ?? sparkService.refund)(userKey, {
          microSparks: toolMicroSparks,
          idempotencyKey: `refund:${precharge.transaction.key}`,
          requestHash: await hash(JSON.stringify({ refundOfTransactionKey: precharge.transaction.key, microSparks: toolMicroSparks })),
          chargeTransactionKey: precharge.transaction.key,
          executionIdentity: executionIdentity!,
        });
        if (refunded.status === 'conflict') throw new Error(`Spark refund conflicted for ${slug}.`);
        chargedAmount = 0;
        sparkTransactionKey = null;
      } catch (refundError) {
        executionError = new SparkRefundError(error, { cause: refundError });
      }
    }
    if (userKey && cost.actionCharges.length) {
      for (const item of [...cost.actionCharges].reverse()) {
        if (item.accepted || item.result.status !== 'applied') continue;
        try {
          const refunded = await (options.refund ?? sparkService.refund)(userKey, {
            microSparks: item.amount,
            idempotencyKey: `refund:${item.result.transaction.key}`,
            requestHash: await hash(JSON.stringify({ refundOfTransactionKey: item.result.transaction.key, microSparks: item.amount })),
            chargeTransactionKey: item.result.transaction.key,
            executionIdentity: item.executionIdentity,
          });
          if (refunded.status === 'conflict') throw new Error(`Spark action refund conflicted for ${slug}.`);
        } catch (refundError) {
          executionError = new SparkRefundError(executionError, { cause: refundError });
        }
      }
      chargedAmount = 0;
      sparkTransactionKey = null;
    }
  } finally {
    if (recorder) {
      const metrics = usage.observed ? { inputTokens: usage.inputTokens, outputTokens: usage.outputTokens, totalTokens: usage.totalTokens } : {};
      await recorder({ ...actor(context), slug, appKey, status, microSparks: status === 'completed' ? chargedAmount : 0, sparkTransactionKey: status === 'completed' ? sparkTransactionKey : null, ...metrics }, eventKey ? { key: eventKey } : undefined)
        .catch((error) => console.warn('tool event recording failed', error instanceof Error ? error.message : String(error)));
    }
  }
  if (executionError !== undefined) throw executionError;
  return result as T;
}
