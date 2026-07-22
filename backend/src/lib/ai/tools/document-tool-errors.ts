import { z } from 'zod';

export const DOCUMENT_ERROR_CODES = [
  'DOCUMENT_UNAUTHORIZED',
  'DOCUMENT_FORBIDDEN',
  'DOCUMENT_NOT_FOUND',
  'DOCUMENT_CONFLICT',
  'DOCUMENT_INVALID_INPUT',
  'DOCUMENT_BATCH_PARTIAL_FAILURE',
  'FOLDER_CYCLE_DETECTED',
  'FOLDER_NOT_EMPTY',
  'FOLDER_DOCUMENTD',
  'FOLDER_MOVE_FORBIDDEN',
  'DOCUMENT_UNSUPPORTED_TYPE',
  'DOCUMENT_INVALID_MIME_TYPE',
  'DOCUMENT_TOO_LARGE',
  'DOCUMENT_PROCESSING_FAILED',
  'DOCUMENT_EXTRACTION_FAILED',
  'DOCUMENT_EMBEDDING_FAILED',
  'DOCUMENT_INSERT_FAILED',
  'DOCUMENT_DOCUMENTD',
  'DOCUMENT_VERSION_CONFLICT',
  'DOCUMENT_SHARE_INVALID',
  'DOCUMENT_SPEECH_FAILED',
  'DOCUMENT_SEARCH_INVALID_SOURCE',
  'DOCUMENT_SEARCH_NO_ACCESSIBLE_SOURCES',
  'DOCUMENT_SEARCH_EMBEDDING_FAILED',
] as const;

export const documentErrorCodeSchema = z.enum(DOCUMENT_ERROR_CODES);
export type DocumentErrorCode = z.infer<typeof documentErrorCodeSchema>;

export const documentErrorSchema = z.object({
  code: documentErrorCodeSchema,
  message: z.string().trim().min(1),
  tool: z.string().trim().min(1),
  action: z.string().trim().min(1).optional(),
  retryable: z.boolean(),
  resourceKey: z.string().trim().min(1).optional(),
  cause: z.string().trim().min(1).optional(),
}).strict();

export type DocumentErrorShape = z.infer<typeof documentErrorSchema>;

export class DocumentError extends Error {
  readonly code: DocumentErrorCode;
  readonly tool: string;
  readonly action?: string;
  readonly retryable: boolean;
  readonly resourceKey?: string;
  override readonly cause?: unknown;

  constructor(code: DocumentErrorCode, message: string, tool: string, options: {
    action?: string;
    retryable?: boolean;
    resourceKey?: string;
    cause?: unknown;
  } = {}) {
    super(message, { cause: options.cause });
    this.name = 'DocumentError';
    this.code = code;
    this.tool = tool;
    this.action = options.action;
    this.retryable = options.retryable ?? false;
    this.resourceKey = options.resourceKey;
  }

  toJSON(): DocumentErrorShape {
    return documentErrorSchema.parse({
      code: this.code,
      message: this.message,
      tool: this.tool,
      action: this.action,
      retryable: this.retryable,
      resourceKey: this.resourceKey,
      // Internal/provider errors stay on the thrown instance for diagnostics but never cross the tool boundary.
      cause: undefined,
    });
  }
}
