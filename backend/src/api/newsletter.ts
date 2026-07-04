import { upsertUserByEmail } from './users';

export function normalizeNewsletterEmail(email: string) {
  return email.trim().toLowerCase();
}

export async function joinNewsletter(email: string) {
  const user = await upsertUserByEmail(normalizeNewsletterEmail(email), {
    is_subscribed_to_updates: true,
  });

  return { subscribed: true as const, subscription: user };
}
