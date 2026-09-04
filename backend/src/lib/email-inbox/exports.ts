import { z } from 'zod';
import { emailMessageRecordSchema, emailThreadRecordSchema } from '@/lib/db/email-records.node';
import type { PreparedDocumentRepresentation } from '@/lib/ai/document-processing';
import { archiveDocument, emailMessageSemanticText } from './archive-payloads';

const exportTargetSchema = z.object({
  scopeKey: z.string().cuid(),
  exportKey: z.string().cuid(),
  folderKey: z.string().cuid(),
  exportedAt: z.string().datetime(),
}).strict();

export function exportEmailThreadToArchive(record: unknown, target: unknown, representation?: PreparedDocumentRepresentation) {
  const thread = emailThreadRecordSchema.parse(record);
  const destination = exportTargetSchema.parse(target);
  if (thread.scopeKey !== destination.scopeKey) throw new Error('Email Archive export must remain in the canonical record scope.');
  if (thread.key === destination.exportKey) throw new Error('Email Archive exports require an identity independent from canonical persistence.');
  const fallback = `${thread.summary}\n\n${thread.intent}${thread.action ? `\n\n${thread.action}` : ''}`;
  return archiveDocument({ key: destination.exportKey, scopeKey: destination.scopeKey, folderKey: destination.folderKey, name: thread.subject, content: representation?.content ?? fallback, representation, embedding: thread.embedding, createdAt: destination.exportedAt, updatedAt: destination.exportedAt, mutationPolicy: 'user' });
}

export function exportEmailMessageToArchive(record: unknown, target: unknown, representation?: PreparedDocumentRepresentation) {
  const message = emailMessageRecordSchema.parse(record);
  const destination = exportTargetSchema.parse(target);
  if (message.scopeKey !== destination.scopeKey) throw new Error('Email Archive export must remain in the canonical record scope.');
  if (message.key === destination.exportKey) throw new Error('Email Archive exports require an identity independent from canonical persistence.');
  return archiveDocument({ key: destination.exportKey, scopeKey: destination.scopeKey, folderKey: destination.folderKey, name: message.subject, content: representation?.content ?? emailMessageSemanticText(message), representation, embedding: message.embedding, createdAt: destination.exportedAt, updatedAt: destination.exportedAt, mutationPolicy: 'user' });
}
