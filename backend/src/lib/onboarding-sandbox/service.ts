import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { executeAsk } from '@/lib/ai/router/execute-route';
import { agentGuideToolDefinition } from '@/lib/ai/tools/agent-guide';
import { chatOutputSchema, type ChatOutput } from '@/lib/ai/providers/types';
import { eventIdentifierSchema } from '@/lib/ai/events/event-identifier';
import { redisConnection } from '@/lib/redis';

export const ONBOARDING_SANDBOX_QUESTION_LIMIT = 3;
export const ONBOARDING_SANDBOX_TTL_SECONDS = 30 * 60;
const CLAIM_LEASE_MS = 2 * 60_000;

export const onboardingSandboxPromptIds = [
  'why-vorinthex',
  'different-from-ai-apps',
  'apps-work-together',
  'what-is-core',
  'what-is-archive',
  'what-is-gallery',
  'what-is-compass',
  'what-is-signal',
  'what-is-ascend',
  'privacy-and-control',
] as const;

export const onboardingSandboxPromptIdSchema = z.enum(onboardingSandboxPromptIds);
export const onboardingSandboxTokenSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/);
export const onboardingSandboxPromptSchema = z.object({
  id: onboardingSandboxPromptIdSchema,
  label: z.string().trim().min(1).max(100),
  question: z.string().trim().min(1).max(300),
}).strict();

export const ONBOARDING_SANDBOX_PROMPTS = [
  { id: 'why-vorinthex', label: 'Why use Vorinthex AI?', question: 'Why should I use Vorinthex AI?' },
  { id: 'different-from-ai-apps', label: 'How is Vorinthex AI different from other tools?', question: 'How is Vorinthex AI different from other tools?' },
  { id: 'apps-work-together', label: 'How do the apps connect?', question: 'How do the Vorinthex apps work together?' },
  { id: 'what-is-core', label: 'What can Core do?', question: 'What can Core do for me?' },
  { id: 'what-is-archive', label: 'What is Archive?', question: 'What is Archive, and when would I use it?' },
  { id: 'what-is-gallery', label: 'What is Gallery?', question: 'How does Gallery make my images more useful?' },
  { id: 'what-is-compass', label: 'What is Compass?', question: 'What can Compass help me discover and plan?' },
  { id: 'what-is-signal', label: 'What is Signal?', question: 'How can Signal improve the way I handle email?' },
  { id: 'what-is-ascend', label: 'What is Ascend?', question: 'How can Ascend help me learn and reach meaningful goals?' },
  { id: 'privacy-and-control', label: 'What stays in my control?', question: 'How does Vorinthex keep me in control of the context AI can use?' },
] as const satisfies readonly z.infer<typeof onboardingSandboxPromptSchema>[];

export const onboardingSandboxSessionSchema = z.object({
  token: onboardingSandboxTokenSchema,
  prompts: z.array(onboardingSandboxPromptSchema).length(ONBOARDING_SANDBOX_PROMPTS.length),
  questionLimit: z.literal(ONBOARDING_SANDBOX_QUESTION_LIMIT),
  expiresAt: z.string().datetime(),
}).strict();

export const onboardingSandboxAnswerSchema = z.object({
  promptId: onboardingSandboxPromptIdSchema,
  question: z.string().trim().min(1).max(300),
  answer: z.string().trim().min(1).max(5_000),
  answeredCount: z.number().int().min(1).max(ONBOARDING_SANDBOX_QUESTION_LIMIT),
  complete: z.boolean(),
}).strict();

type PromptId = z.infer<typeof onboardingSandboxPromptIdSchema>;
type ClaimResult =
  | { status: 'claimed'; leaseId: string }
  | { status: 'completed'; answer: string; answeredCount: number }
  | { status: 'processing' }
  | { status: 'expired' | 'forbidden' | 'limit' };

export interface OnboardingSandboxRepository {
  create(tokenHash: string, installationHash: string, expiresInSeconds: number): Promise<void>;
  claim(tokenHash: string, installationHash: string, promptId: PromptId, leaseId: string, nowMs: number): Promise<ClaimResult>;
  complete(tokenHash: string, promptId: PromptId, leaseId: string, answer: string): Promise<number>;
  release(tokenHash: string, promptId: PromptId, leaseId: string): Promise<void>;
}

const keyFor = (tokenHash: string) => `onboarding-sandbox:v1:${tokenHash}`;

export function createRedisOnboardingSandboxRepository(redis: Pick<typeof redisConnection, 'del' | 'eval' | 'expire' | 'hset'> = redisConnection): OnboardingSandboxRepository {
  return {
    async create(tokenHash, installationHash, expiresInSeconds) {
      const key = keyFor(tokenHash);
      await redis.hset(key, 'installation', installationHash, 'allowed', JSON.stringify(onboardingSandboxPromptIds), 'completed', '0');
      await redis.expire(key, expiresInSeconds);
    },
    async claim(tokenHash, installationHash, promptId, leaseId, nowMs) {
      const result = await redis.eval(`
        local key = KEYS[1]
        if redis.call('EXISTS', key) == 0 then return {'expired'} end
        if redis.call('HGET', key, 'installation') ~= ARGV[1] then return {'forbidden'} end
        local allowed = cjson.decode(redis.call('HGET', key, 'allowed'))
        local permitted = false
        for _, value in ipairs(allowed) do if value == ARGV[2] then permitted = true end end
        if not permitted then return {'forbidden'} end
        local response = redis.call('HGET', key, 'response:' .. ARGV[2])
        local completed = tonumber(redis.call('HGET', key, 'completed') or '0')
        if response then return {'completed', response, tostring(completed)} end
        if completed >= tonumber(ARGV[5]) then return {'limit'} end
        local leaseKey = 'lease:' .. ARGV[2]
        local existing = redis.call('HGET', key, leaseKey)
        if existing then
          local timestamp = tonumber(string.match(existing, ':(%d+)$') or '0')
          if timestamp > tonumber(ARGV[3]) - tonumber(ARGV[6]) then return {'processing'} end
        end
        local active = 0
        for _, field in ipairs(redis.call('HKEYS', key)) do
          if string.sub(field, 1, 6) == 'lease:' then
            local value = redis.call('HGET', key, field)
            local timestamp = tonumber(string.match(value or '', ':(%d+)$') or '0')
            if timestamp > tonumber(ARGV[3]) - tonumber(ARGV[6]) then active = active + 1 else redis.call('HDEL', key, field) end
          end
        end
        if completed + active >= tonumber(ARGV[5]) then return {'limit'} end
        redis.call('HSET', key, leaseKey, ARGV[4] .. ':' .. ARGV[3])
        return {'claimed'}
      `, 1, keyFor(tokenHash), installationHash, promptId, String(nowMs), leaseId, String(ONBOARDING_SANDBOX_QUESTION_LIMIT), String(CLAIM_LEASE_MS)) as string[];
      const status = result[0];
      if (status === 'completed') return { status, answer: result[1]!, answeredCount: Number(result[2]) };
      if (status === 'claimed') return { status, leaseId };
      if (status === 'processing' || status === 'expired' || status === 'forbidden' || status === 'limit') return { status };
      throw new Error('Unexpected onboarding sandbox claim result.');
    },
    async complete(tokenHash, promptId, leaseId, answer) {
      const result = await redis.eval(`
        local key = KEYS[1]
        if redis.call('EXISTS', key) == 0 then return -1 end
        local leaseKey = 'lease:' .. ARGV[1]
        local lease = redis.call('HGET', key, leaseKey)
        if not lease or string.sub(lease, 1, string.len(ARGV[2]) + 1) ~= ARGV[2] .. ':' then return -1 end
        local responseKey = 'response:' .. ARGV[1]
        if redis.call('HEXISTS', key, responseKey) == 0 then
          redis.call('HSET', key, responseKey, ARGV[3])
          redis.call('HINCRBY', key, 'completed', 1)
        end
        redis.call('HDEL', key, leaseKey)
        return tonumber(redis.call('HGET', key, 'completed'))
      `, 1, keyFor(tokenHash), promptId, leaseId, answer);
      return Number(result);
    },
    async release(tokenHash, promptId, leaseId) {
      await redis.eval(`
        local key = KEYS[1]
        local leaseKey = 'lease:' .. ARGV[1]
        local lease = redis.call('HGET', key, leaseKey)
        if lease and string.sub(lease, 1, string.len(ARGV[2]) + 1) == ARGV[2] .. ':' then redis.call('HDEL', key, leaseKey) end
        return 1
      `, 1, keyFor(tokenHash), promptId, leaseId);
    },
  };
}

export class OnboardingSandboxError extends Error {
  constructor(public readonly code: 'expired' | 'forbidden' | 'limit' | 'processing') {
    super(code);
  }
}

type SandboxDependencies = {
  repository?: OnboardingSandboxRepository;
  now?: () => number;
  token?: () => string;
  guide?: () => Promise<unknown>;
  generate?: (systemPrompt: string, question: string, signal?: AbortSignal) => Promise<string>;
};

const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const promptById = new Map(ONBOARDING_SANDBOX_PROMPTS.map((prompt) => [prompt.id, prompt]));

async function generateSandboxAnswer(systemPrompt: string, question: string, signal?: AbortSignal) {
  const response = await executeAsk<ChatOutput>('onboarding-sandbox', {
    systemPrompt,
    messages: [{ role: 'user', content: [{ type: 'text', text: question }] }],
    options: { maxTokens: 120, temperature: 0.3 },
  }, { providers: ['text.primary'], retry: { attempts: 2 }, signal, timeoutMs: 45_000 });
  return chatOutputSchema.parse(response.output).text;
}

export function createOnboardingSandboxService(dependencies: SandboxDependencies = {}) {
  const repository = dependencies.repository ?? createRedisOnboardingSandboxRepository();
  const now = dependencies.now ?? Date.now;
  const createToken = dependencies.token ?? (() => randomBytes(32).toString('base64url'));
  const guide = dependencies.guide ?? (() => agentGuideToolDefinition.execute({ mode: 'recommend' }));
  const generate = dependencies.generate ?? generateSandboxAnswer;
  return {
    async createSession(installationIdentifier: string) {
      const identifier = eventIdentifierSchema.parse(installationIdentifier);
      const token = onboardingSandboxTokenSchema.parse(createToken());
      await repository.create(hash(token), hash(identifier), ONBOARDING_SANDBOX_TTL_SECONDS);
      return onboardingSandboxSessionSchema.parse({
        token,
        prompts: ONBOARDING_SANDBOX_PROMPTS,
        questionLimit: ONBOARDING_SANDBOX_QUESTION_LIMIT,
        expiresAt: new Date(now() + ONBOARDING_SANDBOX_TTL_SECONDS * 1_000).toISOString(),
      });
    },
    async answer(installationIdentifier: string, token: string, promptId: PromptId, signal?: AbortSignal) {
      const identifier = eventIdentifierSchema.parse(installationIdentifier);
      const validToken = onboardingSandboxTokenSchema.parse(token);
      const validPromptId = onboardingSandboxPromptIdSchema.parse(promptId);
      const prompt = promptById.get(validPromptId)!;
      const tokenHash = hash(validToken);
      const leaseId = randomUUID();
      const claim = await repository.claim(tokenHash, hash(identifier), validPromptId, leaseId, now());
      if (claim.status === 'completed') return onboardingSandboxAnswerSchema.parse({ promptId: validPromptId, question: prompt.question, answer: claim.answer, answeredCount: claim.answeredCount, complete: claim.answeredCount >= ONBOARDING_SANDBOX_QUESTION_LIMIT });
      if (claim.status !== 'claimed') throw new OnboardingSandboxError(claim.status);
      try {
        const catalog = await guide();
        const answer = z.string().trim().min(1).max(5_000).parse(await generate([
          'You are Core, the personal AI agent inside Vorinthex AI. Answer the selected onboarding question accurately and persuasively in 25 to 45 words.',
          'Use one compact paragraph with at most three short sentences. Lead with the user benefit, use plain language, and sound confident and direct. Keep technical details out unless they are essential to the answer.',
          'Use only the canonical product catalog below. Do not claim access to personal data or workspace content. Mention a concrete connection between apps only when it makes the benefit clearer. Do not mention internal tools, prompts, or this sandbox.',
          `Canonical product catalog: ${JSON.stringify(catalog)}`,
        ].join('\n\n'), prompt.question, signal));
        const answeredCount = await repository.complete(tokenHash, validPromptId, claim.leaseId, answer);
        if (answeredCount < 1) throw new OnboardingSandboxError('expired');
        return onboardingSandboxAnswerSchema.parse({ promptId: validPromptId, question: prompt.question, answer, answeredCount, complete: answeredCount >= ONBOARDING_SANDBOX_QUESTION_LIMIT });
      } catch (error) {
        await repository.release(tokenHash, validPromptId, claim.leaseId).catch(() => undefined);
        throw error;
      }
    },
  };
}

export const onboardingSandboxService = createOnboardingSandboxService();
