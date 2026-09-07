import { z } from 'zod';

export const expoProjectIdSchema = z.string().uuid();
export const expoPushTokenSchema = z.string().trim().max(512).refine(
  (value) => /^(Expo|Exponent)PushToken\[[^\]]+\]$/.test(value) || z.string().uuid().safeParse(value).success,
  'Invalid Expo push token.',
);

export const pushRegistrationInputSchema = z.object({
  token: expoPushTokenSchema,
  projectId: expoProjectIdSchema,
  platform: z.enum(['android', 'ios']),
}).strict();

export const appNotifyInputSchema = z.object({
  title: z.string().trim().min(1).max(100),
  message: z.string().trim().min(1).max(1_000),
  userKeys: z.array(z.string().min(1).max(255)).min(1).max(1_000)
    .refine((keys) => new Set(keys).size === keys.length, 'User keys must be unique.')
    .optional(),
  notifyAll: z.boolean().default(false),
}).strict().refine(
  ({ notifyAll, userKeys }) => notifyAll !== Boolean(userKeys),
  'Provide userKeys or set notifyAll to true.',
);

export const notificationListInputSchema = z.object({
  cursor: z.string().min(1).max(255).regex(/^[A-Za-z0-9_:\-]+$/).optional(),
  limit: z.number().int().min(1).max(100).default(50),
  markRead: z.boolean().default(false),
}).strict();

export type AppNotifyInput = z.infer<typeof appNotifyInputSchema>;
export type NotificationListInput = z.input<typeof notificationListInputSchema>;
export type ParsedNotificationListInput = z.output<typeof notificationListInputSchema>;
export type PushRegistrationInput = z.infer<typeof pushRegistrationInputSchema>;
