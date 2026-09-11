import { z } from 'zod';
import { executeAsk, type ExecuteActionOptions } from '@/lib/ai/router';
import { USER_VISIBLE_AI_PROSE_POLICY } from '@/lib/ai/prose-style';

export const agentGreetingOccasionSchema = z.enum(['onboarding', 'returning']);
export type AgentGreetingOccasion = z.infer<typeof agentGreetingOccasionSchema>;

const greetingOutputSchema = z.object({
  text: z.string().trim().min(1).max(500),
  toolCalls: z.tuple([]),
  stopReason: z.string().nullable(),
}).strict();

const DASH_CHARACTER = /[-\u2010-\u2015\u2212]/u;
const COMPANY_REFERENCE = /\bVorinthex(?:\s+AI)?\b/i;
const PRODUCT_REFERENCE = /\b(?:Archive|Gallery|Signal|Compass|Ascend|Core)\b/;
const OVERSTATED_WELCOME = /\bwonderful\b/i;
const RECENT_ACTIVITY_CLAIM = /\b(?:recent(?:ly)?|last time|continue where|pick up where|reviewed your|your activity)\b/i;
const REFERRAL_REFERENCE = /\b(?:refer(?:ral|red)?|invite|code)\b/i;
const fallbackGreetings = {
  onboardingReferral: 'Your account is ready. A friend who referred you can receive 50 Sparks now and another 100 after your first subscription payment. Do you have their referral code?',
  onboardingComplete: 'Your account is ready. What would you like to work on first?',
  returning: ['Welcome back. What would you like to work on?', 'Good to see you. How can I help today?', 'Ready when you are. What should we work on?'],
};

export type AgentGreetingContext = Readonly<{ shouldAskReferral?: boolean }>;

function prompt(occasion: AgentGreetingOccasion, context: AgentGreetingContext) {
  if (occasion === 'onboarding' && context.shouldAskReferral !== false) return `Write Core's opening message immediately after account onboarding. In a neutral, concise tone, say the account is ready and ask whether someone referred the user and whether they have that referral code. Explain that applying it gives the friend 50 Sparks for account creation and 100 more after the user's first subscription payment. Use at most three sentences and 45 words. Do not mention any company or product name. Output only the greeting. ${USER_VISIBLE_AI_PROSE_POLICY}`;
  if (occasion === 'onboarding') return `Write Core's brief opening message after account onboarding. In a neutral tone, say the account is ready and ask what the user would like to work on first. Use at most two sentences and 25 words. Do not mention any company or product name. Output only the greeting. ${USER_VISIBLE_AI_PROSE_POLICY}`;
  return `Write a fresh, neutral greeting from Core when the user opens the app. Do not call the return wonderful, claim knowledge of recent activity, or mention any company or product name. Ask what they would like to do. Use one or two concise sentences under 25 words and vary the opening naturally. Output only the greeting. ${USER_VISIBLE_AI_PROSE_POLICY}`;
}

function validGreeting(text: string, occasion: AgentGreetingOccasion, context: AgentGreetingContext) {
  const wordLimit = occasion === 'returning' || context.shouldAskReferral === false ? 25 : 45;
  if (!text.endsWith('?') || text.split(/\s+/u).length > wordLimit || DASH_CHARACTER.test(text) || COMPANY_REFERENCE.test(text) || PRODUCT_REFERENCE.test(text) || OVERSTATED_WELCOME.test(text) || RECENT_ACTIVITY_CLAIM.test(text)) return false;
  if (occasion !== 'onboarding') return true;
  if (context.shouldAskReferral === false) return !REFERRAL_REFERENCE.test(text);
  return REFERRAL_REFERENCE.test(text) && /\bcode\b/i.test(text) && /\b50\b/.test(text) && /\b100\b/.test(text);
}

export type AgentGreetingExecutor = typeof executeAsk;

export async function generateAgentGreeting(teamKey: string, occasion: AgentGreetingOccasion, context: AgentGreetingContext = {}, options: ExecuteActionOptions = {}, execute: AgentGreetingExecutor = executeAsk) {
  const parsedOccasion = agentGreetingOccasionSchema.parse(occasion);
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const response = await execute(teamKey, {
      systemPrompt: prompt(parsedOccasion, context),
      messages: [{ role: 'user', content: [{ type: 'text', text: attempt === 0 ? 'Generate the opening greeting now.' : 'Regenerate it. End with a question, use no product name, avoid the word wonderful, and use no hyphen or dash characters.' }] }],
      options: { maxTokens: 80, temperature: attempt === 0 ? 0.9 : 0.3 },
    }, { providers: ['text.primary'], retry: { attempts: 2 }, timeoutMs: 45_000, ...options });
    const text = greetingOutputSchema.parse(response.output).text;
    if (validGreeting(text, parsedOccasion, context)) return text;
  }
  if (parsedOccasion === 'onboarding') return context.shouldAskReferral === false ? fallbackGreetings.onboardingComplete : fallbackGreetings.onboardingReferral;
  const index = [...teamKey].reduce((sum, character) => sum + character.charCodeAt(0), 0) % fallbackGreetings.returning.length;
  return fallbackGreetings.returning[index]!;
}
