export const MICRO_SPARKS_PER_SPARK = 1_000_000;
export const ACCOUNT_GRANT_SPARKS = 500;
export const ACCOUNT_GRANT_MICRO_SPARKS = ACCOUNT_GRANT_SPARKS * MICRO_SPARKS_PER_SPARK;
export const REFERRAL_PROGRAM_VERSION = 'v1' as const;
export const REFERRAL_SIGNUP_REWARD_MICRO_SPARKS = 50_000_000;
export const REFERRAL_PAID_REWARD_MICRO_SPARKS = 100_000_000;
export const STORAGE_SPARKS_PER_GB_MONTH = 15;
export const RERANK_SPARKS_PER_MILLION_TOKENS = 20;
export const BYTES_PER_GB = 1_000_000_000;
export const HOURS_PER_BILLING_MONTH = 730;

export const STORAGE_MICRO_SPARK_NUMERATOR = BigInt(STORAGE_SPARKS_PER_GB_MONTH * MICRO_SPARKS_PER_SPARK);
export const STORAGE_MICRO_SPARK_DENOMINATOR = BigInt(BYTES_PER_GB) * BigInt(HOURS_PER_BILLING_MONTH);
export const STORAGE_BYTE_MILLISECOND_DENOMINATOR = STORAGE_MICRO_SPARK_DENOMINATOR * 3_600_000n;
const DOTTED_SLUG = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*(?:\.[a-z][a-z0-9]*(?:-[a-z0-9]+)*)+$/;
const ACTION_SLUG = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*(?:\.[a-z][a-z0-9]*(?:-[a-z0-9]+)*)*$/;

export type CostQuantity = 'invocation' | 'documents' | 'images' | 'new-email';
export type FixedCostRule = Readonly<{ type: 'fixed'; microSparks: number; quantity?: CostQuantity }>;
export type PublicFixedCostRule = FixedCostRule & Readonly<{ name: string; description: string; showInPricing?: false }>;
export type PurchaseGrantRule = Readonly<{ microSparks: number }>;
export type CostRuleSource = 'tool' | 'action';
export type ResolvedCostRule = Readonly<{ source: CostRuleSource; slug: string; rule: FixedCostRule }>;
export type ToolCostPolicy = Readonly<{ mode: 'fixed' | 'outcome'; rule: FixedCostRule; paidOutcome: 'operation-completed' | 'queue-accepted' }> | Readonly<{ mode: 'action' | 'free' }>;

// A capability-level tool price wins over its underlying action price so one
// invocation can never be charged at both levels.
export const COST_RULE_PRECEDENCE = Object.freeze(['tool', 'action'] as const);
const purchaseGrant = (value: number): PurchaseGrantRule => Object.freeze({ microSparks: value * MICRO_SPARKS_PER_SPARK });

export const PURCHASE_GRANT_RULES: Readonly<Record<string, PurchaseGrantRule>> = Object.freeze({
  'nova.weekly': purchaseGrant(200),
  'nova.monthly': purchaseGrant(1_000),
  'topup.small': purchaseGrant(200),
});

export function lookupPurchaseGrant(productId: string): PurchaseGrantRule | null {
  const rule = PURCHASE_GRANT_RULES[assertDottedSlug(productId)];
  if (!rule) return null;
  if (!Number.isSafeInteger(rule.microSparks) || rule.microSparks <= 0) throw new RangeError('A purchase grant must contain a positive safe integer number of microSparks.');
  return rule;
}

export function resolvePurchaseGrantMicroSparks(productId: string): number {
  const rule = lookupPurchaseGrant(productId);
  if (!rule) throw new RangeError(`No purchase grant is configured for product: ${productId}`);
  return rule.microSparks;
}

export const TOOL_COST_RULES: Readonly<Record<string, PublicFixedCostRule>> = Object.freeze({});
export const ACTION_COST_RULES: Readonly<Record<string, FixedCostRule>> = Object.freeze({});

export const ACTION_PRICED_OPERATION_TOOL_SLUGS = Object.freeze([
  'agent.query', 'agent.greet', 'agent.image', 'agent.speech', 'agent.video', 'agents.core', 'app.generate-image', 'conversation.message.send', 'file.upload.caption',
] as const);

export const TOOL_COST_POLICIES: Readonly<Record<string, ToolCostPolicy>> = Object.freeze({
  ...Object.fromEntries(ACTION_PRICED_OPERATION_TOOL_SLUGS.map((slug) => [slug, Object.freeze({ mode: 'action' as const })])),
});

export function lookupToolCostPolicy(toolSlug: string, input?: unknown): ToolCostPolicy | null {
  const slug = assertDottedSlug(toolSlug);
  if (slug === 'ticket.create') return { mode: 'action' };
  return TOOL_COST_POLICIES[slug] ?? null;
}

function safeNonnegativeInteger(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value < 0) throw new RangeError(`${name} must be a nonnegative safe integer.`);
  return value;
}

function safeBigInt(value: number | bigint, name: string): bigint {
  if (typeof value === 'number') safeNonnegativeInteger(value, name);
  if (value < 0) throw new RangeError(`${name} must be nonnegative.`);
  return BigInt(value);
}

function toSafeNumber(value: bigint, name: string): number {
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) throw new RangeError(`${name} exceeds the safe integer range.`);
  return Number(value);
}

export function assertDottedSlug(slug: string): string {
  if (!DOTTED_SLUG.test(slug)) throw new TypeError(`Invalid dotted slug: ${slug}`);
  return slug;
}

export function assertActionSlug(slug: string): string {
  if (!ACTION_SLUG.test(slug)) throw new TypeError(`Invalid action slug: ${slug}`);
  return slug;
}

export function sparksToMicroSparks(sparks: string | number): number {
  const value = typeof sparks === 'number' ? String(sparks) : sparks;
  const match = /^(0|[1-9]\d*)(?:\.(\d{1,6}))?$/.exec(value);
  if (!match) throw new TypeError('Sparks must be a nonnegative decimal with at most six fractional digits.');
  const whole = BigInt(match[1]);
  const fraction = BigInt((match[2] ?? '').padEnd(6, '0'));
  return toSafeNumber(whole * BigInt(MICRO_SPARKS_PER_SPARK) + fraction, 'microSparks');
}

export function formatMicroSparks(microSparks: number): string {
  if (!Number.isSafeInteger(microSparks)) throw new RangeError('microSparks must be a safe integer.');
  const sign = microSparks < 0 ? '-' : '';
  const absolute = BigInt(Math.abs(microSparks));
  const whole = absolute / BigInt(MICRO_SPARKS_PER_SPARK);
  const fraction = (absolute % BigInt(MICRO_SPARKS_PER_SPARK)).toString().padStart(6, '0').replace(/0+$/, '');
  return `${sign}${whole}${fraction ? `.${fraction}` : ''}`;
}

export function calculateByteHours(bytes: number | bigint, hours: number | bigint): bigint {
  return safeBigInt(bytes, 'bytes') * safeBigInt(hours, 'hours');
}

export function storageCostFraction(byteHours: number | bigint): Readonly<{ numerator: bigint; denominator: bigint }> {
  return {
    numerator: safeBigInt(byteHours, 'byteHours') * STORAGE_MICRO_SPARK_NUMERATOR,
    denominator: STORAGE_MICRO_SPARK_DENOMINATOR,
  };
}

export function storageCostMicroSparks(byteHours: number | bigint): number {
  return toSafeNumber(BigInt(storageCostMicroSparksExact(byteHours)), 'storage cost');
}

export function storageCostMicroSparksExact(byteHours: number | bigint): string {
  const { numerator, denominator } = storageCostFraction(byteHours);
  const roundedUp = numerator === 0n ? 0n : (numerator + denominator - 1n) / denominator;
  return roundedUp.toString();
}

export function calculateStorageMicroSparks(
  byteMilliseconds: string | number | bigint,
  previousRemainder: string | number | bigint = 0n,
): Readonly<{ amountMicroSparks: string; remainder: string }> {
  const parse = (value: string | number | bigint, name: string) => {
    if (typeof value === 'string' && !/^(0|[1-9]\d*)$/.test(value)) throw new TypeError(`${name} must be a canonical nonnegative integer.`);
    if (typeof value === 'number') safeNonnegativeInteger(value, name);
    return BigInt(value);
  };
  const usage = parse(byteMilliseconds, 'Storage usage');
  const carry = parse(previousRemainder, 'Storage remainder');
  if (usage < 0n || carry < 0n || carry >= STORAGE_BYTE_MILLISECOND_DENOMINATOR) {
    throw new RangeError('Storage usage and remainder are out of range.');
  }
  const numerator = usage * STORAGE_MICRO_SPARK_NUMERATOR + carry;
  return {
    amountMicroSparks: (numerator / STORAGE_BYTE_MILLISECOND_DENOMINATOR).toString(),
    remainder: (numerator % STORAGE_BYTE_MILLISECOND_DENOMINATOR).toString(),
  };
}

export function validateFixedCostRule(rule: FixedCostRule): FixedCostRule {
  if (rule.type !== 'fixed' || !Number.isSafeInteger(rule.microSparks) || rule.microSparks <= 0) {
    throw new RangeError('A fixed cost must contain a positive safe integer number of microSparks.');
  }
  return rule;
}

function arrayLength(value: unknown, keys: readonly string[]): number | null {
  if (typeof value !== 'object' || value === null) return null;
  for (const key of keys) {
    const candidate = (value as Record<string, unknown>)[key];
    if (Array.isArray(candidate)) return candidate.length;
  }
  return null;
}

export function fixedCostQuantity(rule: FixedCostRule, input: unknown): number {
  if (!rule.quantity || rule.quantity === 'invocation') return 1;
  const count = rule.quantity === 'images'
    ? arrayLength(input, ['images', 'imageUrls', 'imageKeys', 'items'])
    : rule.quantity === 'documents'
      ? arrayLength(input, ['documents', 'documentKeys', 'items'])
      : arrayLength(input, ['messages', 'messageIds', 'items']);
  return count ?? 1;
}

export function calculateFixedCost(rule: FixedCostRule, input?: unknown): number {
  const quantity = fixedCostQuantity(validateFixedCostRule(rule), input);
  if (!Number.isSafeInteger(quantity) || quantity < 0) throw new RangeError('Cost quantity must be a nonnegative safe integer.');
  const amount = BigInt(rule.microSparks) * BigInt(quantity);
  return toSafeNumber(amount, 'fixed cost');
}

export function calculateToolCostMicroSparks(toolSlug: string, input?: unknown): number {
  const resolved = lookupCostRule({ toolSlug });
  return resolved ? calculateFixedCost(resolved.rule, input) : 0;
}

export function calculateActionCostMicroSparks(actionSlug: string, usage: Readonly<{ inputTokens: number; outputTokens: number }>, input?: unknown): number {
  assertActionSlug(actionSlug);
  const inputTokens = safeBigInt(usage.inputTokens, 'inputTokens');
  const outputTokens = safeBigInt(usage.outputTokens, 'outputTokens');
  let numerator = 0n;
  let denominator = 1n;
  const operation = typeof input === 'object' && input !== null ? (input as Record<string, unknown>).operation : undefined;
  if (actionSlug === 'text' || actionSlug === 'image' && operation === 'caption') {
    numerator = inputTokens * 40n * BigInt(MICRO_SPARKS_PER_SPARK) + outputTokens * 400n * BigInt(MICRO_SPARKS_PER_SPARK);
    denominator = 1_000_000n;
  } else if (actionSlug === 'speech') {
    const text = typeof input === 'object' && input !== null ? (input as Record<string, unknown>).text : undefined;
    if (typeof text !== 'string' || !text.trim()) throw new TypeError('Speech billing requires submitted text.');
    numerator = BigInt(Array.from(text.trim()).length) * 10_000n;
  } else if (actionSlug === 'image') {
    const count = typeof input === 'object' && input !== null ? (input as Record<string, unknown>).count : undefined;
    const images = Number.isSafeInteger(count) && (count as number) >= 0 ? BigInt(count as number) : BigInt(arrayLength(input, ['images', 'imageUrls', 'imageKeys']) ?? 1);
    numerator = images * BigInt(operation === 'generate' ? 15 : 5) * BigInt(MICRO_SPARKS_PER_SPARK);
  } else if (actionSlug === 'video') {
    const duration = typeof input === 'object' && input !== null ? (input as Record<string, unknown>).durationSeconds : undefined;
    if (!Number.isSafeInteger(duration) || (duration as number) < 5 || (duration as number) > 15) throw new TypeError('Video billing requires a duration from 5 to 15 seconds.');
    numerator = BigInt(duration as number) * 15n * BigInt(MICRO_SPARKS_PER_SPARK);
  } else if (actionSlug === 'embed') {
    return 0;
  } else if (actionSlug === 'rerank') {
    // 20 Sparks per million processed tokens = 20 microSparks per token.
    numerator = (inputTokens + outputTokens) * BigInt(RERANK_SPARKS_PER_MILLION_TOKENS);
  } else if (actionSlug === 'decide') {
    // 10 Sparks per million output tokens = 10 microSparks per output token.
    // Jev's input tokens are deliberately free to the user.
    numerator = outputTokens * 10n;
  }
  const rounded = numerator === 0n ? 0n : (numerator + denominator - 1n) / denominator;
  return toSafeNumber(rounded, 'action cost');
}

export function lookupCostRule(input: Readonly<{ toolSlug?: string; actionSlug?: string }>): ResolvedCostRule | null {
  if (input.toolSlug !== undefined) {
    const slug = assertDottedSlug(input.toolSlug);
    const rule = TOOL_COST_RULES[slug];
    if (rule) return { source: 'tool', slug, rule: validateFixedCostRule(rule) };
  }
  if (input.actionSlug !== undefined) {
    const slug = assertActionSlug(input.actionSlug);
    const rule = ACTION_COST_RULES[slug];
    if (rule) return { source: 'action', slug, rule: validateFixedCostRule(rule) };
  }
  return null;
}
