export type OrderedEmailMessage = { sentAt: string; providerMessageId: string };

export function compareEmailMessages(a: OrderedEmailMessage, b: OrderedEmailMessage) {
  return a.sentAt.localeCompare(b.sentAt) || a.providerMessageId.localeCompare(b.providerMessageId);
}

export function latestEmailMessage<T extends OrderedEmailMessage>(messages: readonly T[]): T | undefined {
  return messages.reduce<T | undefined>((latest, message) => !latest || compareEmailMessages(latest, message) < 0 ? message : latest, undefined);
}
