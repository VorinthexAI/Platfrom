import type { DomainToolContext } from './domain-execute';
import type { ContentToolDependencies } from './content-runtime';
import type { ContentToolInput, ContentToolOutput } from './content-schemas';
import { createBookRuntime } from '@/lib/books/runtime';

type BookToolName = 'book.create-context' | 'book.write';

export async function runBookContentTool<Name extends BookToolName>(name: Name, input: ContentToolInput<Name>, context: DomainToolContext, dependencies: ContentToolDependencies): Promise<ContentToolOutput<Name>> {
  if (context.principal.kind !== 'member') throw new Error('A human organization member is required');
  const runtime = dependencies.bookRuntime ?? createBookRuntime();
  const { idempotencyKey: _idempotencyKey, ...bookInput } = input;
  const brief = { ...bookInput, organizationKey: context.organizationKey };
  const access = { organizationKey: context.organizationKey, scopeKey: input.scopeKey, userKey: context.principal.user.key };
  if (name === 'book.create-context') return { bookKey: await runtime.create(brief, access), status: 'planning' } as ContentToolOutput<Name>;
  const writeInput = input as ContentToolInput<'book.write'>;
  await runtime.write(writeInput.bookKey, brief, access);
  return { bookKey: writeInput.bookKey, status: 'ready' } as ContentToolOutput<Name>;
}
