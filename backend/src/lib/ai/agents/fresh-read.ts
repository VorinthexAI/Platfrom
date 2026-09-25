import { findWorkspaceGraph } from '@/lib/app-search/graph-query';
import type { ToolContext } from '@/lib/ai/tools/tool-context';

/** A recent phrase that is also indexed private data needs a current read. */
export async function requiresFreshWorkspaceRead(
  message: string,
  context: ToolContext,
  history: readonly string[],
  find: typeof findWorkspaceGraph = findWorkspaceGraph,
) {
  const words = (value: string) => value.normalize('NFKC').toLocaleLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
  const phrases = (value: string) => {
    const terms = words(value);
    const output: string[] = [];
    for (let size = 3; size >= 2; size--) for (let index = 0; index <= terms.length - size; index++) {
      const parts = terms.slice(index, index + size);
      if (parts.every((part) => part.length >= 3)) output.push(parts.join(' '));
    }
    return output;
  };
  const recent = new Set(history.slice(-6).flatMap(phrases));
  const shared = [...new Set(phrases(message))].filter((phrase) => recent.has(phrase)).slice(0, 4);
  if (!shared.length) return false;
  try {
    for (const phrase of shared) if ((await find(phrase, context, 1)).length) return true;
    return false;
  } catch {
    // If we cannot verify a plausible private reference, do not answer stale
    // account facts from prior prose alone.
    return true;
  }
}
