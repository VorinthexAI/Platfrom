import { AiError } from '@/lib/ai/shared/result';
import type { DocumentActionName } from './schemas';

export class DocumentProcessingError extends AiError {
  readonly action: DocumentActionName | 'document.parse';

  constructor(code: string, message: string, action: DocumentActionName | 'document.parse', options?: { retryable?: boolean; cause?: unknown }) {
    super(code, message, options);
    this.action = action;
  }
}

/** A deterministic defect in caller-supplied bytes or locally extracted content. */
export class DocumentInputError extends DocumentProcessingError {
  constructor(code: string, message: string, action: 'document-validate' | 'document-extract', options?: { cause?: unknown }) {
    super(code, message, action, { retryable: false, cause: options?.cause });
  }
}

export function documentActionError(
  error: unknown,
  code: string,
  message: string,
  action: DocumentActionName,
  retryable = false,
): DocumentProcessingError {
  return error instanceof DocumentProcessingError
    ? error
    : new DocumentProcessingError(code, message, action, { retryable, cause: error });
}
