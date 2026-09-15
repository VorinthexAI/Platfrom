import { z } from 'zod';
import { executeAsk, streamAsk, type ExecuteActionOptions } from '@/lib/ai/router';
import { USER_VISIBLE_AI_PROSE_POLICY } from '@/lib/ai/prose-style';

export const agentGreetingOccasionSchema = z.enum(['onboarding', 'returning']);
export type AgentGreetingOccasion = z.infer<typeof agentGreetingOccasionSchema>;
export const agentGreetingStateSchema = z.enum(['referral-onboarding', 'new-account', 'returning']);
export type AgentGreetingState = z.infer<typeof agentGreetingStateSchema>;

const greetingOutputSchema = z.object({
  text: z.string().trim().min(1).max(8_000),
  toolCalls: z.tuple([]),
  stopReason: z.string().nullable(),
}).strict();
const generatedGreetingSchema = z.object({
  message: z.string().trim().min(1).max(500),
  guideMode: z.enum(['recommend', 'explain']),
}).strict();

const greetingResponseFormat = {
  name: 'agent_greeting',
  schema: {
    type: 'object', additionalProperties: false, required: ['message', 'guideMode'],
    properties: {
      message: { type: 'string', minLength: 1, maxLength: 500 },
      guideMode: { type: 'string', enum: ['recommend', 'explain'] },
    },
  },
} as const;

const DASH_CHARACTER = /[-\u2010-\u2015\u2212]/u;
const COMPANY_REFERENCE = /\bVorinthex(?:\s+AI)?\b/i;
const PRODUCT_REFERENCE = /\b(?:Archive|Gallery|Signal|Compass|Ascend|Core)\b/;
const OVERSTATED_WELCOME = /\bwonderful\b/i;
const RECENT_ACTIVITY_CLAIM = /\b(?:recent(?:ly)?|last time|continue where|pick up where|reviewed your|your activity)\b/i;
const REFERRAL_REFERENCE = /\b(?:refer(?:ral|red)?|invite|code)\b/i;
const fallbackGreetings = {
  referralOnboarding: 'Your account is ready. A friend who referred you can receive 50 Sparks now and another 100 after your first subscription payment. Do you have their referral code?',
  newAccount: 'Your account is ready. Core can help you work with what you keep in Archive. What would you like to explore first?',
  returning: ['Welcome back. What would you like to work on?', 'Good to see you. How can I help today?', 'Ready when you are. What should we work on?'],
};

function prompt(state: AgentGreetingState, structured = true) {
  const format = structured ? ` Set guideMode to ${state === 'returning' ? 'explain' : 'recommend'}. Return only strict JSON matching the requested schema.` : ' Return only the greeting message as plain text, without JSON, quotes, or commentary.';
  if (state === 'referral-onboarding') return `Write Core's opening message immediately after account onboarding. In a neutral, concise tone, say the account is ready and ask whether someone referred the user and whether they have that referral code. Explain that applying it gives the friend 50 Sparks for account creation and 100 more after the user's first subscription payment. Use at most three sentences and 45 words. Do not mention any company or product name.${format} ${USER_VISIBLE_AI_PROSE_POLICY}`;
  if (state === 'new-account') return `Write Core's brief opening message for a new account. Naturally introduce Core as the assistant and Archive as the place for the user's saved knowledge, including how Core can help them work with Archive. Do not mention referrals, invitations, codes, or any other product. End with a question about what to explore first. Use at most three concise sentences and 35 words.${format} ${USER_VISIBLE_AI_PROSE_POLICY}`;
  return `Write a fresh, neutral greeting from Core when the user opens the app. Do not call the return wonderful, claim knowledge of recent activity, or mention any company or product name. Ask what they would like to do. Use one or two concise sentences under 25 words and vary the opening naturally.${format} ${USER_VISIBLE_AI_PROSE_POLICY}`;
}

function validGreeting(text: string, state: AgentGreetingState) {
  const wordLimit = state === 'referral-onboarding' ? 45 : state === 'new-account' ? 35 : 25;
  if (!text.endsWith('?') || text.split(/\s+/u).length > wordLimit || DASH_CHARACTER.test(text) || COMPANY_REFERENCE.test(text) || OVERSTATED_WELCOME.test(text) || RECENT_ACTIVITY_CLAIM.test(text)) return false;
  if (state === 'new-account') return /\bCore\b/.test(text) && /\bArchive\b/.test(text) && !REFERRAL_REFERENCE.test(text) && !/\b(?:Gallery|Signal|Compass|Ascend)\b/.test(text);
  if (PRODUCT_REFERENCE.test(text)) return false;
  if (state === 'returning') return !REFERRAL_REFERENCE.test(text);
  return REFERRAL_REFERENCE.test(text) && /\bcode\b/i.test(text) && /\b50\b/.test(text) && /\b100\b/.test(text);
}

export type AgentGreetingExecutor = typeof executeAsk;
export type AgentGreetingStreamExecutor = typeof streamAsk;

function fallbackGreeting(teamKey: string, state: AgentGreetingState) {
  if (state === 'referral-onboarding') return { message: fallbackGreetings.referralOnboarding, guideMode: 'recommend' as const };
  if (state === 'new-account') return { message: fallbackGreetings.newAccount, guideMode: 'recommend' as const };
  const index = [...teamKey].reduce((sum, character) => sum + character.charCodeAt(0), 0) % fallbackGreetings.returning.length;
  return { message: fallbackGreetings.returning[index]!, guideMode: 'explain' as const };
}

export async function streamAgentGreeting(teamKey: string, state: AgentGreetingState, onDelta: (text: string) => void | Promise<void>, options: ExecuteActionOptions = {}, stream: AgentGreetingStreamExecutor = streamAsk) {
  const parsedState = agentGreetingStateSchema.parse(state);
  let message = '';
  let done = false;
  for await (const chunk of stream(teamKey, {
    mode: 'default',
    systemPrompt: prompt(parsedState, false),
    messages: [{ role: 'user', content: [{ type: 'text', text: 'Generate the opening greeting now.' }] }],
    options: { maxTokens: 500, temperature: 0.6 },
  }, { providers: ['text.primary'], retry: { attempts: 2 }, timeoutMs: 45_000, ...options })) {
    if (done) throw new Error('The greeting stream emitted data after completion.');
    if (chunk.type === 'done') { done = true; continue; }
    if (chunk.type === 'tool-call') throw new Error('The greeting stream returned a tool call.');
    if (chunk.type !== 'text-delta') continue;
    message += chunk.text;
    await onDelta(chunk.text);
  }
  if (!done) throw new Error('The greeting stream ended before completion.');
  const normalized = message.trim();
  if (normalized.length <= 500 && validGreeting(normalized, parsedState)) return { message: normalized, guideMode: parsedState === 'returning' ? 'explain' as const : 'recommend' as const };
  return fallbackGreeting(teamKey, parsedState);
}

export async function generateAgentGreeting(teamKey: string, state: AgentGreetingState, options: ExecuteActionOptions = {}, execute: AgentGreetingExecutor = executeAsk) {
  const parsedState = agentGreetingStateSchema.parse(state);
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const response = await execute(teamKey, {
      mode: 'default',
      systemPrompt: prompt(parsedState),
      messages: [{ role: 'user', content: [{ type: 'text', text: attempt ? 'The previous response was invalid. Follow every greeting rule and return the required JSON.' : 'Generate the opening greeting now.' }] }],
      responseFormat: greetingResponseFormat,
      options: { maxTokens: 1_000, temperature: attempt === 0 ? 0.6 : 0.2 },
    }, { providers: ['text.primary'], retry: { attempts: 2 }, timeoutMs: 45_000, ...options });
    try {
      const output = greetingOutputSchema.parse(response.output);
      const generated = generatedGreetingSchema.parse(JSON.parse(output.text));
      if (validGreeting(generated.message, parsedState)) return generated;
    } catch {
      // Retry malformed structured output once before returning a safe greeting.
    }
  }
  return fallbackGreeting(teamKey, parsedState);
}
