import { AiError } from '@/lib/ai/shared/result';
import type { DocumentActionName } from './schemas';

export class DocumentProcessingError extends AiError {
  readonly action: DocumentActionName | 'document.processing';

  constructor(code: string, message: string, action: DocumentActionName | 'document.processing', options?: { retryable?: boolean; cause?: unknown }) {
    super(code, message, options);
    this.action = action;
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
