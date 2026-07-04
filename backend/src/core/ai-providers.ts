import Anthropic from '@anthropic-ai/sdk';
import { GoogleGenerativeAI } from '@google/generative-ai';
import OpenAI from 'openai';

export const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY || 'missing-anthropic-key',
});

export const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY || 'missing-openai-key',
});

export const grok = new OpenAI({
  apiKey: process.env.GROK_API_KEY || 'missing-grok-key',
  baseURL: 'https://api.x.ai/v1',
});

export const perplexity = new OpenAI({
  apiKey: process.env.PERPLEXITY_API_KEY || 'missing-perplexity-key',
  baseURL: 'https://api.perplexity.ai',
});

export const google = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY ?? '');

export type ProviderName = 'anthropic' | 'openai' | 'grok' | 'perplexity' | 'google';

