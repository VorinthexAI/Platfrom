import type { z } from 'zod';
import type { artifactLiteralSchema, nodeRefSchema } from './schema';

export type ArtifactLiteral = z.infer<typeof artifactLiteralSchema>;
export type NodeRef = z.infer<typeof nodeRefSchema>;
