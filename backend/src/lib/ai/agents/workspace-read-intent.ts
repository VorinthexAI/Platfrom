import { decisionInputSchema, decisionOutputSchema } from '@/lib/ai/actions/decide';
import { executeAction } from '@/lib/ai/router';
import type { ToolContext } from '@/lib/ai/tools/tool-context';

export async function requiresFileContentRead(message: string, history: readonly string[], context: ToolContext, signal?: AbortSignal): Promise<boolean> {
  const input = decisionInputSchema.parse({
    state: JSON.stringify({ request: message, recentConversation: history.slice(-3).map((item) => item.slice(0, 1_000)) }),
    questions: {
      intent: {
        type: 'choice',
        instructions: 'Decide whether answering the current request requires facts inside an existing private workspace file. Use the recent conversation only to resolve references such as "that photo" or "the document".',
        criteria: {
          read: 'The user wants to know, describe, interpret, compare, summarize, or verify the contents of one or more stored files. This includes image captions and stored audio or video descriptions.',
          other: 'The user asks for file counts or an inventory of which files exist, wants to create content, discusses an attachment already provided directly, or does not need stored file contents.',
        },
      },
    },
  });
  try {
    const result = await executeAction<typeof input, unknown>(
      { mode: 'auto', teamKey: context.teamKey, actionSlug: 'decide' }, input,
      { providers: ['decide.primary'], timeoutMs: 8_000, retry: { attempts: 1 }, signal },
    );
    return decisionOutputSchema.parse(result.output).answers.intent?.choice === 'read';
  } catch (error) {
    if (signal?.aborted) throw error;
    console.warn('file-read intent unavailable; using Core tool selection', { error });
    return false;
  }
}
