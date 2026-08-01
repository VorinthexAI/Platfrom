import { z } from 'zod';

// Existing Chorus channels may use stable opaque keys instead of generated CUIDs.
export const communicationChannelKeySchema = z.string().trim().min(1).max(160);
