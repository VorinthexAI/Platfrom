// Split out of actions.ts: a `"use server"` file's exports are all rewritten
// into server-action RPC references by Next's compiler, so a plain value
// export like a Zod schema silently stops being a real Zod schema once
// imported into a Client Component (surfaces as `zodResolver`'s
// "Invalid input: not a Zod schema" at build/runtime). Schemas shared
// between a Server Action and its client form must live in a plain module.

import { z } from "zod";

export const signupSchema = z.object({
  email: z.string().trim().min(1, "Enter your email.").email("Enter a valid email address."),
  password: z
    .string()
    .min(8, "Use at least 8 characters.")
    .regex(/[a-zA-Z]/, "Include at least one letter.")
    .regex(/[0-9]/, "Include at least one number."),
});

export type SignupInput = z.infer<typeof signupSchema>;
