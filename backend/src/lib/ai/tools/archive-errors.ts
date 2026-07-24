import { z } from 'zod';

export const ARCHIVE_ERROR_CODES = [
  'ARCHIVE_UNAUTHORIZED',
  'ARCHIVE_FORBIDDEN',
  'ARCHIVE_NOT_FOUND',
  'ARCHIVE_CONFLICT',
  'ARCHIVE_INVALID_INPUT',
  'ARCHIVE_BATCH_PARTIAL_FAILURE',
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
  'ARCHIVE_SEARCH_INVALID_SOURCE',
  'ARCHIVE_SEARCH_NO_ACCESSIBLE_SOURCES',
  'ARCHIVE_SEARCH_EMBEDDING_FAILED',
] as const;

export const archiveErrorCodeSchema = z.enum(ARCHIVE_ERROR_CODES);
export type ArchiveErrorCode = z.infer<typeof archiveErrorCodeSchema>;

export const archiveErrorSchema = z.object({
  code: archiveErrorCodeSchema,
  message: z.string().trim().min(1),
  tool: z.string().trim().min(1),
  action: z.string().trim().min(1).optional(),
  retryable: z.boolean(),
  resourceKey: z.string().trim().min(1).optional(),
  cause: z.string().trim().min(1).optional(),
}).strict();

export type ArchiveErrorShape = z.infer<typeof archiveErrorSchema>;

export class ArchiveError extends Error {
  readonly code: ArchiveErrorCode;
  readonly tool: string;
  readonly action?: string;
  readonly retryable: boolean;
  readonly resourceKey?: string;
  override readonly cause?: unknown;

  constructor(code: ArchiveErrorCode, message: string, tool: string, options: {
    action?: string;
    retryable?: boolean;
    resourceKey?: string;
    cause?: unknown;
  } = {}) {
    super(message, { cause: options.cause });
    this.name = 'ArchiveError';
    this.code = code;
    this.tool = tool;
    this.action = options.action;
    this.retryable = options.retryable ?? false;
    this.resourceKey = options.resourceKey;
  }

  toJSON(): ArchiveErrorShape {
    return archiveErrorSchema.parse({
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
