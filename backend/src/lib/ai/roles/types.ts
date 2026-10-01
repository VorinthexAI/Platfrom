import { z } from 'zod';

export const ROLE_KEYS = ['general', 'research', 'writing', 'marketing', 'learning', 'engineering', 'data', 'design', 'business', 'finance', 'legal', 'health'] as const;
export const roleKeySchema = z.enum(ROLE_KEYS);
export type RoleKey = z.infer<typeof roleKeySchema>;
export type RoleDefinition = Readonly<{ key: RoleKey; label: string; description: string; instructions: string }>;
export const publicRoleSchema = z.object({ key: roleKeySchema, label: z.string().min(1), description: z.string().min(1) }).strict();
