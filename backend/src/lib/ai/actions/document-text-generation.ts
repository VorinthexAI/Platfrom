import { z } from 'zod';

export type TextGeneration = (input: { systemPrompt: string; text: string; temperature: number; maxTokens: number }) => Promise<string>;

function plain(value: string) {
  return value.replace(/^```(?:text)?\s*/i, '').replace(/\s*```$/i, '').replace(/\r\n?/g, '\n').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

const sectionsSchema = z.object({ sections: z.array(z.object({ heading: z.string().trim().min(1).max(120), body: z.string().trim().min(1) }).strict()).min(2).max(4) }).strict();

export function parseGeneratedSummary(value: unknown) {
  const raw = z.string().trim().min(1).parse(value).replace(/<(?:analysis|thinking|reasoning)>[\s\S]*?<\/(?:analysis|thinking|reasoning)>/gi, '').trim();
  const candidates = [...raw.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi)].map((match) => match[1]!.trim());
  const firstBrace = raw.indexOf('{'), lastBrace = raw.lastIndexOf('}');
  if (firstBrace >= 0 && lastBrace > firstBrace) candidates.push(raw.slice(firstBrace, lastBrace + 1));
  candidates.push(raw);
  for (const candidate of candidates) {
    try { return sectionsSchema.parse(JSON.parse(candidate)).sections.map(({ heading, body }) => `${plain(heading)}\n${plain(body)}`).join('\n\n'); } catch { /* Try the next model projection. */ }
  }
  if (firstBrace >= 0 || lastBrace >= 0) throw new Error('The summary model returned malformed structured output.');
  const fallback = plain(raw).replace(/^(?:sure[,!.]?\s*|here(?:'s| is) (?:the |a )?summary:?\s*)/i, '').trim();
  return `Summary\n${z.string().min(1).parse(fallback)}`;
}

export async function generateDocumentSummary(input: { documents: Array<{ name: string; content: string }>; topic?: string; style: 'brief' | 'detailed' | 'executive' | 'bullet-points' | 'technical'; language?: string }, generate: TextGeneration) {
  const text = await generate({
    systemPrompt: `Create a ${input.style} summary${input.topic ? ` focused on ${input.topic}` : ''}${input.language ? ` in ${input.language}` : ''}. Use only the supplied document content and preserve its facts. Return strict JSON only in the form {"sections":[{"heading":"Short heading","body":"Prose paragraph"}]}. Return 2 to 4 distinct sections. Bodies must be concise prose paragraphs, never bullet points or numbered lists. Do not include analysis, reasoning, planning, self-reference, a preamble, a conclusion about the task, Markdown, code fences, or commentary. Output the JSON object and nothing else.`,
    text: input.documents.map((item) => `Title: ${item.name}\n\n${item.content}`).join('\n\n---\n\n'),
    temperature: 0.2,
    maxTokens: 5_000,
  });
  return parseGeneratedSummary(text);
}

export async function generateDocumentTranslation(input: { content: string; targetLanguage: string; sourceLanguage?: string; instruction?: string; preserveFormatting?: boolean }, generate: TextGeneration) {
  const text = await generate({
    systemPrompt: `Translate the supplied text${input.sourceLanguage ? ` from ${input.sourceLanguage}` : ''} into ${input.targetLanguage} using fluent, idiomatic target-language grammar. The target language label may be an English name, a native name or endonym, an ISO language code, or mildly misspelled; infer the intended language before translating. Preserve meaning, facts, tone, and useful structure. Trim leading and trailing whitespace, remove trailing spaces, collapse excessive blank lines, and organize longer content into readable sections with concise plain-text headings when the material supports them. Do not force headings into short content. ${input.preserveFormatting ? 'Preserve meaningful paragraph boundaries and formatting.' : 'Use clear, natural prose.'} Do not add Markdown decoration or commentary. ${input.instruction ? `Additional direction: ${input.instruction} ` : ''}Return only the translated text.`,
    text: input.content,
    temperature: 0.1,
    maxTokens: Math.min(5_000, Math.max(256, Math.ceil(input.content.length / 3))),
  });
  return z.string().trim().min(1).parse(plain(text));
}
