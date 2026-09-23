import { z } from 'zod';
import { strictObject } from './validation';

// Google advertises RFC 9207 issuer responses. Keep the provider boundary strict
// while accepting the documented response metadata at every callback layer.
export const googleOAuthCallbackSchema = strictObject({
  code: z.string().min(1).max(4096).optional(),
  state: z.string().min(1).max(256).optional(),
  iss: z.literal('https://accounts.google.com').optional(),
  error: z.string().max(200).optional(),
  scope: z.string().max(2000).optional(),
  authuser: z.string().max(20).optional(),
  prompt: z.string().max(200).optional(),
  hd: z.string().max(320).optional(),
  error_description: z.string().max(1000).optional(),
  error_subtype: z.string().max(200).optional(),
  session_state: z.string().max(500).optional(),
});

export const emailOAuthCallbackSchema = googleOAuthCallbackSchema.extend({
  state: z.string().startsWith('vrtx_email_state_').max(256),
});

export const googleSignInCallbackSchema = googleOAuthCallbackSchema.extend({
  code: z.string().min(1).max(4096),
  state: z.string().min(1).max(256),
});
