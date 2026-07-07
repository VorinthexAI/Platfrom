import { mkdir } from "node:fs/promises";
import path from "node:path";
import { atomicWrite } from "./filesystem";
import type { OpenAIClient } from "./openai";

export async function writeReview(input: {
  client?: OpenAIClient;
  imagePath: string;
  prompt: string;
  reviewPath: string;
}): Promise<string> {
  await mkdir(path.dirname(input.reviewPath), { recursive: true });
  let markdown: string;
  if (!input.client) {
    markdown = `# Review

Review skipped because OPENAI_API_KEY is not configured.

## Recommended next prompt

Set OPENAI_API_KEY and run Review asset for model-based critique.
`;
  } else {
    markdown = (await input.client.reviewImage({ imagePath: input.imagePath, prompt: input.prompt })).markdown;
  }
  await atomicWrite(input.reviewPath, markdown.endsWith("\n") ? markdown : `${markdown}\n`);
  return markdown;
}
