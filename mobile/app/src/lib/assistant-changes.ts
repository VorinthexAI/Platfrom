import { z } from "zod";

export const assistantChangeSchema = z.strictObject({
  workspace: z.enum(["archive", "gallery", "signal", "compass", "ascend"]),
});
export const assistantChangesSchema = z.array(assistantChangeSchema).optional();
export type AssistantChange = z.infer<typeof assistantChangeSchema>;
