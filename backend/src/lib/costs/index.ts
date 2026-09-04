export const MICRO_SPARKS_PER_SPARK = 1_000_000;
export const ACCOUNT_GRANT_SPARKS = 100;
export const ACCOUNT_GRANT_MICRO_SPARKS = ACCOUNT_GRANT_SPARKS * MICRO_SPARKS_PER_SPARK;
export const STORAGE_SPARKS_PER_GIB_MONTH = 24;
export const BYTES_PER_GIB = 1_073_741_824;
export const HOURS_PER_BILLING_MONTH = 730;

export const STORAGE_MICRO_SPARK_NUMERATOR = BigInt(STORAGE_SPARKS_PER_GIB_MONTH * MICRO_SPARKS_PER_SPARK);
export const STORAGE_MICRO_SPARK_DENOMINATOR = BigInt(BYTES_PER_GIB) * BigInt(HOURS_PER_BILLING_MONTH);
export const STORAGE_BYTE_MILLISECOND_DENOMINATOR = STORAGE_MICRO_SPARK_DENOMINATOR * 3_600_000n;
const DOTTED_SLUG = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*(?:\.[a-z][a-z0-9]*(?:-[a-z0-9]+)*)+$/;
const ACTION_SLUG = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*(?:\.[a-z][a-z0-9]*(?:-[a-z0-9]+)*)*$/;

export type CostQuantity = 'invocation' | 'documents' | 'images';
export type FixedCostRule = Readonly<{ type: 'fixed'; microSparks: number; quantity?: CostQuantity }>;
export type CostRuleSource = 'tool' | 'action';
export type ResolvedCostRule = Readonly<{ source: CostRuleSource; slug: string; rule: FixedCostRule }>;
export type ToolCostPolicy = Readonly<{ mode: 'fixed' | 'outcome'; rule: FixedCostRule; paidOutcome: 'operation-completed' | 'queue-accepted' }> | Readonly<{ mode: 'action' | 'free' }>;

// A capability-level tool price wins over its underlying action price so one
// invocation can never be charged at both levels.
export const COST_RULE_PRECEDENCE = Object.freeze(['tool', 'action'] as const);
const sparks = (value: number, quantity?: CostQuantity): FixedCostRule => Object.freeze({
  type: 'fixed', microSparks: value * MICRO_SPARKS_PER_SPARK, ...(quantity ? { quantity } : {}),
});

export const TOOL_COST_RULES: Readonly<Record<string, FixedCostRule>> = Object.freeze({
  'book.create': sparks(100),
  'book.extend': sparks(30),
  'highlight.create': sparks(20),
  'image.create-memory': sparks(10),
  'subject.create': sparks(15),
  'email.tone.create': sparks(25),
  'trip.create': sparks(15),
  'place.create': sparks(5),
  'place.guide.find': sparks(5),
  'place.find-city': sparks(5),
  'document.parse': sparks(2, 'documents'),
  'document.scan': sparks(5, 'documents'),
  'web.search': sparks(25),
  'image.caption': sparks(5, 'images'),
});
export const ACTION_COST_RULES: Readonly<Record<string, FixedCostRule>> = Object.freeze({});

export const ACTION_METERED_TOOL_SLUGS = Object.freeze([
  'agents.core', 'app.enhance', 'app.search', 'app.speech', 'app.translate',
  'book.goal.suggest', 'book.topic.suggest',
  'conversation.image.enqueue', 'conversation.message.send',
  'document.rewrite', 'document.summarize', 'document.topics',
  'email.draft.compose', 'email.draft.create', 'email.message.summarize',
  'feedback.create',
  'image.create-visual-identity', 'image.generate', 'image.ideas.create',
  'inbox.sort',
  'place.find', 'place.reference.generate',
  'trip.guide.generate',
] as const);

export const OUTCOME_METERED_TOOL_SLUGS = Object.freeze([
  'place.find-children', 'place.find-city', 'place.guide.find',
] as const);

// This list is intentionally exhaustive rather than a fallback. Adding a public
// tool without choosing fixed, action, or free billing must fail registry tests.
export const FREE_TOOL_SLUGS = Object.freeze([
  'agent.query', 'billing.summary.read',
  'book.chapter.progress', 'book.delete', 'book.detail', 'book.favorite', 'book.generation.cancel', 'book.generation.retry', 'book.list', 'book.share.detail', 'book.share.update',
  'collection.create', 'collection.delete', 'collection.duplicates.delete', 'collection.hide', 'collection.image.transfer', 'collection.invite.accept', 'collection.invite.create', 'collection.invite.pending.list', 'collection.invite.reject', 'collection.invite.revoke', 'collection.leave', 'collection.list', 'collection.member.list', 'collection.member.remove', 'collection.member.role.update', 'collection.reveal', 'collection.share.activate', 'collection.share.create', 'collection.share.list', 'collection.share.revoke', 'collection.share.update', 'collection.update',
  'content.hidden.list', 'content.neighbors', 'content.search', 'content.search-history.delete', 'content.search-history.list',
  'conversation.create', 'conversation.delete', 'conversation.favorite', 'conversation.list', 'conversation.message.delete', 'conversation.message.list', 'conversation.rename', 'conversation.search',
  'country.search',
  'document.audio.playback.clear', 'document.audio.playback.update', 'document.copy', 'document.create', 'document.create-version', 'document.delete', 'document.delete-version', 'document.download', 'document.export', 'document.find', 'document.find-summary', 'document.find-version', 'document.hide', 'document.list', 'document.list-audio-versions', 'document.list-shares', 'document.list-summaries', 'document.list-versions', 'document.move', 'document.read', 'document.rename', 'document.restore-version', 'document.reveal', 'document.search', 'document.search-all', 'document.share', 'document.unshare', 'document.update',
  'email.draft.assign', 'email.draft.delete', 'email.draft.send', 'email.draft.update', 'email.message.summary.delete', 'email.message.summary.list', 'email.message.translation.delete', 'email.message.translation.list', 'email.overview', 'email.reply-context.create', 'email.reply-context.delete', 'email.reply-context.list', 'email.reply-context.update', 'email.similar.find', 'email.thread.favorite', 'email.thread.read', 'email.thread.read-state', 'email.thread.trash', 'email.tone.delete', 'email.tone.list', 'email.tone.search', 'email.tone.update', 'email.trash.clear',
  'feedback.list', 'feedback.vote',
  'folder.copy', 'folder.create', 'folder.delete', 'folder.find', 'folder.hide', 'folder.list', 'folder.move', 'folder.rename', 'folder.reveal', 'folder.update',
  'highlight.delete', 'highlight.list', 'highlight.read',
  'image.delete', 'image.favorite', 'image.generation-history.delete', 'image.generation-history.list', 'image.hide', 'image.memory.delete', 'image.memory.list', 'image.memory.read', 'image.reveal', 'image.search', 'image.update',
  'inbox.refresh', 'inbox.search', 'inbox.update',
  'place.delete', 'place.list', 'place.open', 'place.reference.list', 'place.search', 'place.update',
  'profile.update', 'subject.delete', 'subject.image.list', 'subject.list',
  'tag.assignment.set', 'tag.create', 'tag.delete', 'tag.list', 'tag.update', 'ticket.create',
  'trip.attachment.set', 'trip.delete', 'trip.guide.list', 'trip.list', 'trip.search', 'trip.update',
] as const);

export const TOOL_COST_POLICIES: Readonly<Record<string, ToolCostPolicy>> = Object.freeze({
  ...Object.fromEntries(FREE_TOOL_SLUGS.map((slug) => [slug, Object.freeze({ mode: 'free' as const })])),
  ...Object.fromEntries(ACTION_METERED_TOOL_SLUGS.map((slug) => [slug, Object.freeze({ mode: 'action' as const })])),
  ...Object.fromEntries(OUTCOME_METERED_TOOL_SLUGS.map((slug) => [slug, Object.freeze({ mode: 'outcome' as const, rule: slug === 'place.find-children' ? TOOL_COST_RULES['place.find-city']! : TOOL_COST_RULES[slug]!, paidOutcome: 'operation-completed' as const })])),
  ...Object.fromEntries(Object.entries(TOOL_COST_RULES).filter(([slug]) => !OUTCOME_METERED_TOOL_SLUGS.includes(slug as never)).map(([slug, rule]) => [slug, Object.freeze({ mode: 'fixed' as const, rule, paidOutcome: slug === 'book.create' || slug === 'book.extend' ? 'queue-accepted' as const : 'operation-completed' as const })])),
});

export function lookupToolCostPolicy(toolSlug: string, input?: unknown): ToolCostPolicy | null {
  const slug = assertDottedSlug(toolSlug);
  if (slug === 'book.extend' && typeof input === 'object' && input !== null && (input as Record<string, unknown>).mode === 'preview') return { mode: 'action' };
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
  const { numerator, denominator } = storageCostFraction(byteHours);
  const roundedUp = numerator === 0n ? 0n : (numerator + denominator - 1n) / denominator;
  return toSafeNumber(roundedUp, 'storage cost');
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
    : arrayLength(input, ['documents', 'documentKeys', 'items']);
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
  if (actionSlug === 'text') {
    numerator = inputTokens * 50n * BigInt(MICRO_SPARKS_PER_SPARK) + outputTokens * 500n * BigInt(MICRO_SPARKS_PER_SPARK);
    denominator = 1_000_000n;
  } else if (actionSlug === 'speech') {
    numerator = outputTokens * 10_000n * BigInt(MICRO_SPARKS_PER_SPARK);
    denominator = 1_000_000n;
  } else if (actionSlug === 'image') {
    const operation = typeof input === 'object' && input !== null ? (input as Record<string, unknown>).operation : undefined;
    const count = typeof input === 'object' && input !== null ? (input as Record<string, unknown>).count : undefined;
    const images = Number.isSafeInteger(count) && (count as number) >= 0 ? BigInt(count as number) : BigInt(arrayLength(input, ['images', 'imageUrls', 'imageKeys']) ?? 1);
    numerator = images * BigInt(operation === 'generate' ? 30 : 5) * BigInt(MICRO_SPARKS_PER_SPARK);
  } else if (actionSlug === 'embed') {
    return 0;
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
