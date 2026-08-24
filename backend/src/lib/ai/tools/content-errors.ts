import { z } from 'zod';

export const CONTENT_ERROR_CODES = [
  'CONTENT_UNAUTHORIZED',
  'CONTENT_FORBIDDEN',
  'CONTENT_NOT_FOUND',
  'CONTENT_CONFLICT',
  'CONTENT_IDEMPOTENCY_CONFLICT',
  'CONTENT_IDEMPOTENCY_PENDING',
  'CONTENT_IDEMPOTENCY_INDETERMINATE',
  'CONTENT_IDEMPOTENCY_FAILED',
  'CONTENT_INVALID_INPUT',
  'CONTENT_BATCH_PARTIAL_FAILURE',
  'FOLDER_CYCLE_DETECTED',
  'FOLDER_NOT_EMPTY',
  'FOLDER_ARCHIVED',
  'FOLDER_MOVE_FORBIDDEN',
  'DOCUMENT_UNSUPPORTED_TYPE',
  'DOCUMENT_INVALID_MIME_TYPE',
  'DOCUMENT_TOO_LARGE',
  'DOCUMENT_PROCESSING_FAILED',
  'DOCUMENT_EXTRACTION_FAILED',
  'DOCUMENT_EMBEDDING_FAILED',
  'DOCUMENT_INSERT_FAILED',
  'DOCUMENT_ARCHIVED',
  'DOCUMENT_VERSION_CONFLICT',
  'DOCUMENT_SHARE_INVALID',
  'DOCUMENT_SPEECH_FAILED',
  'CONTENT_SEARCH_INVALID_SOURCE',
  'CONTENT_SEARCH_NO_ACCESSIBLE_SOURCES',
  'CONTENT_SEARCH_EMBEDDING_FAILED',
] as const;

export const contentErrorCodeSchema = z.enum(CONTENT_ERROR_CODES);
export type ContentErrorCode = z.infer<typeof contentErrorCodeSchema>;

export const contentErrorSchema = z.object({
  code: contentErrorCodeSchema,
  message: z.string().trim().min(1),
  tool: z.string().trim().min(1),
  action: z.string().trim().min(1).optional(),
  retryable: z.boolean(),
  resourceKey: z.string().trim().min(1).optional(),
  cause: z.string().trim().min(1).optional(),
}).strict();

export type ContentErrorShape = z.infer<typeof contentErrorSchema>;

export class ContentError extends Error {
  readonly code: ContentErrorCode;
  readonly tool: string;
  readonly action?: string;
  readonly retryable: boolean;
  readonly resourceKey?: string;
  override readonly cause?: unknown;

  constructor(code: ContentErrorCode, message: string, tool: string, options: {
    action?: string;
    retryable?: boolean;
    resourceKey?: string;
    cause?: unknown;
  } = {}) {
    super(message, { cause: options.cause });
    this.name = 'ContentError';
    this.code = code;
    this.tool = tool;
    this.action = options.action;
    this.retryable = options.retryable ?? false;
    this.resourceKey = options.resourceKey;
    this.cause = options.cause;
  }

  toJSON(): ContentErrorShape {
    return contentErrorSchema.parse({
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
