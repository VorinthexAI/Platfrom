import { createHash } from 'node:crypto';
import { z } from 'zod';
import { coreChatInputSchema, coreChatToolDefinitionSchema, type CoreChatMessage, type CoreChatToolDefinition } from '@/lib/ai/actions';
import { streamAsk, type ExecuteActionOptions } from '@/lib/ai/router';
import type { ProviderStreamChunk } from '@/lib/ai/providers';
import { isToolReadOnly, MODEL_TOOL_NAMES, TOOL_DEFINITIONS, runTool, toolInputSchemas, type ToolDependencies } from '@/lib/ai/tools';
import type { ToolContext } from '@/lib/ai/tools/tool-context';
import { projectAppSearchModelResult } from '@/lib/app-search/service';
import { SparkRefundError } from '@/lib/ai/events/runtime';
import { SparkRepositoryError } from '@/lib/sparks/repository';
import {
  agentResponseSchema, agentToolInvocationSchema, agentToolPatternSchema, agentToolStatusSchema, internalAgentRequestSchema,
  type AgentDefinition, type AgentResponse, type AgentToolStatus, type InternalAgentRequest,
} from './schemas';

const RECURSIVE_TOOL = 'conversation.message.send';
const MAX_TOOL_CALLS = 4;
const publicDefinitions = TOOL_DEFINITIONS.map(({ name, description, inputSchema }) => coreChatToolDefinitionSchema.parse({ name, description, inputSchema }));

export interface AgentRuntimeDependencies {
  stream?: typeof streamAsk;
  router?: ExecuteActionOptions;
  initialResponseTimeoutMs?: number;
  tools?: {
    names?: readonly string[];
    definitions?: readonly CoreChatToolDefinition[];
    execute?: (name: string, rawInput: unknown, dependencies: ToolDependencies) => Promise<unknown>;
    dependencies?: ToolDependencies;
  };
  onRoutingMetric?: (metric: AgentRoutingMetric) => void;
}

export type AgentRoutingMetric = {
  stage: 'initial' | 'continuation' | 'tool';
  outcome: 'answered' | 'selected' | 'succeeded' | 'failed';
  candidateCount: number;
  selectedToolCount: number;
  confidence?: 'high' | 'medium' | 'low';
  durationMs: number;
};

export class AgentStreamProtocolError extends Error {}

export interface AgentExecutionContext {
  toolContext: ToolContext;
  conversationService?: ToolDependencies['conversationService'];
  currentConversationKey?: string;
  currentUserMessageContent?: string;
  currentReferenceImageKeys?: string[];
  currentStagedImageArtifactKeys?: string[];
  onDelta?: (text: string) => void | Promise<void>;
  onToolSucceeded?: (slug: string, arguments_: unknown, result: unknown) => boolean | void;
  normalizeToolArguments?: (slug: string, arguments_: unknown) => unknown;
}

export const REGISTERED_AGENTS = Object.freeze([
  { slug: 'core', load: () => import('./core').then(({ coreAgent }) => coreAgent) },
]);

function expandToolPatterns(patterns: readonly string[], names: readonly string[], label: string) {
  const uniquePatterns = [...new Set(patterns.map((pattern) => agentToolPatternSchema.parse(pattern)))];
  const available = new Set(names);
  return uniquePatterns.flatMap((pattern) => {
    if (!pattern.endsWith('.*')) {
      if (!available.has(pattern)) throw new Error(`Unknown agent tool ${label} entry: ${pattern}`);
      return [pattern];
    }
    const prefix = pattern.slice(0, -1);
    const matches = names.filter((name) => name.startsWith(prefix));
    if (!matches.length) throw new Error(`Agent tool ${label} wildcard matched no public tools: ${pattern}`);
    return matches;
  });
}

export function resolveAgentAllowlist(patterns: readonly string[], names: readonly string[] = MODEL_TOOL_NAMES, ownTool?: string, excludedTools: readonly string[] = []) {
  const selected = patterns.length === 0 ? [...names] : expandToolPatterns(patterns, names, 'allowlist');
  const available = new Set(names);
  const excluded = new Set(excludedTools.flatMap((pattern) => {
    if (pattern.endsWith('.*')) return names.filter((name) => name.startsWith(pattern.slice(0, -1)));
    return available.has(pattern) ? [pattern] : [];
  }));
  return [...new Set(selected)].filter((name) => !excluded.has(name) && name !== ownTool && name !== RECURSIVE_TOOL && !name.startsWith('agents.'));
}

function currentRequestMessage(request: InternalAgentRequest, includeAttachments = true): CoreChatMessage {
  return { role: 'user', content: [...(includeAttachments ? request.attachments.map((attachment) => attachment.kind === 'image'
    ? { type: 'image' as const, mimeType: attachment.mimeType, bytes: attachment.bytes }
    : { type: 'file' as const, filename: attachment.filename, mimeType: attachment.mimeType, bytes: attachment.bytes }) : []), { type: 'text', text: request.message }] };
}

function userMessages(request: InternalAgentRequest): CoreChatMessage[] {
  const background: CoreChatMessage = { role: 'user', content: [{ type: 'text', text: JSON.stringify({ ...(request.currentConversationSummary ? { currentConversationSummary: request.currentConversationSummary } : {}), recalledContext: request.recalledContext ?? [], currentDate: request.currentDate }) }] };
  const recent: CoreChatMessage[] = (request.context ?? []).map(({ role, content }) => ({ role, content: [{ type: 'text', text: content }] }));
  const preloaded = request.preloadedTools.flatMap((tool, index): CoreChatMessage[] => {
    const toolCallId = `preloaded-${index + 1}`;
    const status = successfulStatus(tool.slug, tool.arguments, tool.result);
    return [
      { role: 'assistant', content: [{ type: 'tool-call', toolCallId, name: tool.slug, arguments: tool.arguments }] },
      { role: 'tool', content: [{ type: 'tool-result', toolCallId, result: status }] },
    ];
  });
  return [background, ...recent, ...preloaded, currentRequestMessage(request)];
}

const generatedConversationNameSchema = z.object({
  name: z.string().trim().min(1).max(80).refine((value) => value.split(/\s+/).length <= 5, 'Conversation names may contain at most five words.'),
}).strict();

async function generateConversationName(teamKey: string, message: string, stream: typeof streamAsk, router?: ExecuteActionOptions) {
  const input = coreChatInputSchema.parse({
    systemPrompt: 'Create a specific, concise English chat name that captures the primary intent of the user message, regardless of the language used in that message. Use 1 to 5 words, never a sentence, and do not end with punctuation. Return only the requested JSON.',
    messages: [{ role: 'user', content: [{ type: 'text', text: JSON.stringify({ message }) }] }],
    responseFormat: {
      name: 'conversation_name',
      schema: { type: 'object', additionalProperties: false, required: ['name'], properties: { name: { type: 'string', minLength: 1, maxLength: 80 } } },
    },
    options: { maxTokens: 32, temperature: 0.1 },
  });
  let output = '';
  let done = false;
  for await (const chunk of stream(teamKey, input, { ...router, capabilities: {}, timeoutMs: Math.min(router?.timeoutMs ?? 15_000, 15_000) })) {
    if (done) throw new Error('The conversation-name stream emitted data after completion.');
    if (chunk.type === 'done') { done = true; continue; }
    if (chunk.type === 'tool-call') throw new Error('The conversation-name stream returned a tool call.');
    if (chunk.type === 'text-delta') output += chunk.text;
  }
  if (!done) throw new Error('The conversation-name stream ended before completion.');
  return generatedConversationNameSchema.parse(JSON.parse(output)).name;
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right)).map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(',')}}`;
  return JSON.stringify(value) ?? 'null';
}

function deterministicToolRequestKey(requestKey: string, slug: string, args: unknown) {
  return createHash('sha256').update(canonicalJson(slug === 'app.generate-image' ? { requestKey, slug } : { requestKey, slug, arguments: args })).digest('hex');
}

function safeFailure(error: unknown) {
  if (error instanceof Error && error.name === 'AbortError') throw error;
  return 'The requested capability failed. Verify the request or try a different approach.';
}

function successfulStatus(slug: string, args: unknown, result: unknown) {
  const base = { slug, arguments: args, status: 'succeeded' as const };
  const projected = slug === 'app.search' ? projectAppSearchModelResult(result) : result ?? null;
  const parsed = agentToolStatusSchema.safeParse({ ...base, result: projected });
  return parsed.success ? parsed.data : agentToolStatusSchema.parse({ ...base, result: { omitted: true, reason: 'The capability result was too large or could not be serialized for model context.' } });
}

type SearchRetry = { collectionSlugs: unknown; filters: unknown; limit: unknown; operation: unknown; query: string };
type SearchOutcome = { kind: 'empty'; retry: SearchRetry } | { kind: 'nonempty' };
type ExecutionOutcome = { status: AgentToolStatus; searchOutcome?: SearchOutcome; finish?: boolean };

function appSearchOutcome(args: unknown, result: unknown): SearchOutcome | undefined {
  if (!args || typeof args !== 'object' || !result || typeof result !== 'object') return undefined;
  const input = args as Record<string, unknown>;
  const output = result as Record<string, unknown>;
  if ((input.operation ?? 'search') !== 'search' || typeof input.query !== 'string' || !Array.isArray(output.groups)) return undefined;
  const groups = output.groups as Array<Record<string, unknown>>;
  if (!groups.length || groups.some((group) => !Array.isArray(group.results))) return undefined;
  if (groups.some((group) => (group.results as unknown[]).length > 0)) return { kind: 'nonempty' };
  return { kind: 'empty', retry: { collectionSlugs: input.collectionSlugs, filters: input.filters, limit: input.limit, operation: input.operation ?? 'search', query: input.query } };
}

function assertSearchReformulation(base: SearchRetry, args: unknown) {
  if (!args || typeof args !== 'object') throw new Error('The app.search reformulation must preserve the original search constraints.');
  const input = args as Record<string, unknown>;
  const unchanged = canonicalJson(input.collectionSlugs) === canonicalJson(base.collectionSlugs)
    && canonicalJson(input.filters) === canonicalJson(base.filters)
    && canonicalJson(input.limit) === canonicalJson(base.limit)
    && (input.operation ?? 'search') === base.operation;
  if (!unchanged || typeof input.query !== 'string' || input.query.trim() === base.query.trim()) throw new Error('The app.search reformulation must change only the query.');
}

function assertActiveMember(context: ToolContext) {
  if (context.principal.kind !== 'member' || context.principal.userTeam.status !== 'active') throw new Error('An active user team membership is required to execute an agent.');
  if (context.principal.userTeam.teamKey !== context.teamKey || context.principal.userTeam.userId !== context.principal.user.key) throw new Error('Agent membership does not match the selected user and team.');
}

export async function runAgent(
  definition: AgentDefinition,
  rawRequest: unknown,
  context: AgentExecutionContext,
  dependencies: AgentRuntimeDependencies = {},
): Promise<AgentResponse> {
  const request = internalAgentRequestSchema.parse(rawRequest);
  assertActiveMember(context.toolContext);
  const runtimeDefinition = { ...definition, systemPrompt: request.systemPrompt };
  const stream = dependencies.stream ?? streamAsk;
  const suppliedNames = dependencies.tools?.names ?? MODEL_TOOL_NAMES;
  const suppliedDefinitions = (dependencies.tools?.definitions ?? publicDefinitions).map((item) => coreChatToolDefinitionSchema.parse(item));
  const definitionsByName = new Map(suppliedDefinitions.map((item) => [item.name, item]));
  const preloadedNames = new Set(request.preloadedTools.map(({ slug }) => slug));
  const allowedNames = resolveAgentAllowlist(definition.allowlist, suppliedNames, `agents.${definition.slug}`, definition.excludedTools).filter((name) => !preloadedNames.has(name as 'agent.guide'));
  const allowedNameSet = new Set(allowedNames);
  for (const name of allowedNames) if (!definitionsByName.has(name)) throw new Error(`Missing provider definition for authorized agent tool: ${name}`);
  const execute = dependencies.tools?.execute ?? ((name: string, input: unknown, deps: ToolDependencies) => {
    if (!deps.contentContext) throw new Error(`Tool ${name} requires contentContext.`);
    return runTool(name, `agents.${definition.slug}`, input, { ...deps, contentContext: deps.contentContext });
  });
  const emit = context.onDelta ?? (() => {});
  const messages: CoreChatMessage[] = userMessages(request);
  const currentRequestIndex = messages.length - 1;
  const statuses: AgentToolStatus[] = request.preloadedTools.map((tool) => successfulStatus(tool.slug, tool.arguments, tool.result));
  const executions = new Map<string, Promise<ExecutionOutcome>>();
  const singleShotExecutions = new Map<string, Promise<ExecutionOutcome>>();
  const observe = (metric: AgentRoutingMetric) => { try { dependencies.onRoutingMetric?.(metric); } catch { /* Metrics never affect execution. */ } };
  const namePromise = request.generateName
    ? generateConversationName(context.toolContext.teamKey, request.message, stream, dependencies.router).catch(() => undefined)
    : undefined;
  let emittedCalls = 0;
  let searchRetry: SearchRetry | undefined;
  let appSearchClosed = false;
  let turn = 0;

  while (true) {
    const finalTurn = emittedCalls >= MAX_TOOL_CALLS;
    const stage = turn === 0 ? 'initial' as const : 'continuation' as const;
    const startedAt = performance.now();
    const toolDefinitions = finalTurn ? undefined : allowedNames.map((toolName) => definitionsByName.get(toolName)!);
    const input = coreChatInputSchema.parse({
      systemPrompt: runtimeDefinition.systemPrompt,
      messages,
      ...(toolDefinitions?.length ? { tools: toolDefinitions } : {}),
      options: { maxTokens: 8_192, temperature: 0.2 },
    });
    const calls: Extract<ProviderStreamChunk, { type: 'tool-call' }>[] = [];
    let rawText = '';
    let done = false;
    let outputMode: 'text' | 'tools' | undefined;
    const initialResponseController = new AbortController();
    const initialResponseTimer = setTimeout(() => initialResponseController.abort(new DOMException('The agent did not begin responding in time.', 'TimeoutError')), dependencies.initialResponseTimeoutMs ?? (request.attachments.length ? 30_000 : 15_000));
    const signal = dependencies.router?.signal ? AbortSignal.any([dependencies.router.signal, initialResponseController.signal]) : initialResponseController.signal;
    let receivedChunk = false;
    try {
      for await (const chunk of stream(context.toolContext.teamKey, input, {
        ...dependencies.router,
        signal,
        capabilities: { ...dependencies.router?.capabilities, ...definition.capabilities },
        timeoutMs: dependencies.router?.timeoutMs ?? 60_000,
      })) {
        if (!receivedChunk) { receivedChunk = true; clearTimeout(initialResponseTimer); }
        if (done) throw new Error('The agent stream emitted data after completion.');
        if (chunk.type === 'done') {
          done = true;
          continue;
        }
        if (chunk.type === 'tool-call') {
          if (outputMode === 'text') throw new AgentStreamProtocolError('The agent selected a tool after emitting visible text.');
          outputMode = 'tools';
          calls.push(chunk);
          continue;
        }
        if (chunk.type !== 'text-delta') continue;
        if (outputMode === 'tools') throw new AgentStreamProtocolError('The agent emitted visible text after selecting a tool.');
        outputMode = 'text';
        rawText += chunk.text;
        await emit(chunk.text);
      }
    } finally {
      clearTimeout(initialResponseTimer);
    }
    if (!done) throw new Error('The agent stream ended before completion.');
    if (finalTurn && calls.length) throw new Error('The agent called a tool during the tool-free final response.');
    if (!calls.length) {
      if (!rawText.trim()) throw new Error('The agent returned neither visible text nor a tool call.');
      observe({ stage, outcome: 'answered', candidateCount: toolDefinitions?.length ?? 0, selectedToolCount: 0, confidence: 'medium', durationMs: performance.now() - startedAt });
      const name = await namePromise;
      return agentResponseSchema.parse({ message: rawText, ...(name ? { name } : {}), tools: statuses });
    }
    if (calls.length > MAX_TOOL_CALLS - emittedCalls) throw new Error(`The agent exceeded its ${MAX_TOOL_CALLS}-call limit.`);

    const preparedCalls = calls.map(({ toolCall: call }) => {
      if (!allowedNameSet.has(call.name)) throw new Error(`The agent requested an unauthorized tool: ${call.name}`);
      let invocation = agentToolInvocationSchema.parse({ slug: call.name, arguments: context.normalizeToolArguments?.(call.name, call.arguments) ?? call.arguments });
      let invalidArguments = false;
      if (!dependencies.tools?.execute) {
        const parsedArguments = toolInputSchemas[call.name]?.safeParse(invocation.arguments);
        if (parsedArguments?.success) invocation = agentToolInvocationSchema.parse({ ...invocation, arguments: parsedArguments.data });
        else invalidArguments = true;
      }
      return { call, invocation, invalidArguments, readOnly: invalidArguments ? false : isToolReadOnly(call.name, invocation.arguments) };
    });
    if (preparedCalls.length > 1 && preparedCalls.some(({ readOnly }) => !readOnly)) throw new Error('The agent returned multiple tool calls when every call must be read-only.');
    const searchCalls = preparedCalls.filter(({ invocation }) => invocation.slug === 'app.search' && ((invocation.arguments as Record<string, unknown> | null)?.operation ?? 'search') === 'search');
    if (searchCalls.length > 1) throw new Error('Only one app.search semantic query may be emitted per batch.');
    if (searchCalls[0]) {
      if (appSearchClosed) throw new Error('The app.search retry limit has been reached for this request.');
      if (searchRetry) assertSearchReformulation(searchRetry, searchCalls[0].invocation.arguments);
    }
    emittedCalls += preparedCalls.length;
    observe({ stage, outcome: 'selected', candidateCount: toolDefinitions?.length ?? 0, selectedToolCount: preparedCalls.length, confidence: 'high', durationMs: performance.now() - startedAt });

    const assistantContent: CoreChatMessage['content'] = preparedCalls.map(({ call, invocation }) => ({ type: 'tool-call' as const, toolCallId: call.id, name: call.name, arguments: invocation.arguments, ...(call.opaqueState ? { opaqueState: call.opaqueState } : {}) }));
    messages.push({ role: 'assistant', content: assistantContent });

    const executePrepared = ({ invocation, invalidArguments }: typeof preparedCalls[number]) => {
      const fingerprint = deterministicToolRequestKey(request.requestKey, invocation.slug, invocation.arguments);
      const prior = executions.get(fingerprint);
      if (prior) return prior;
      const singleShotPrior = singleShotExecutions.get(invocation.slug);
      if (invocation.slug === 'app.generate-image' && singleShotPrior) return singleShotPrior;
      const promise = (async (): Promise<ExecutionOutcome> => {
        if (invalidArguments) {
          const status = agentToolStatusSchema.parse({ ...invocation, status: 'failed', error: 'Tool arguments were invalid. Correct the arguments without adding identity, scope, or unrelated fields, then retry.' });
          observe({ stage: 'tool', outcome: 'failed', candidateCount: allowedNames.length, selectedToolCount: 1, durationMs: 0 });
          return { status };
        }
        const toolStartedAt = performance.now();
        try {
          const result = await execute(invocation.slug, invocation.arguments, {
            ...dependencies.tools?.dependencies, ...dependencies.router,
            teamKey: context.toolContext.teamKey,
            contentContext: context.toolContext,
            conversationService: context.conversationService,
            currentConversationKey: context.currentConversationKey,
            currentUserMessageContent: context.currentUserMessageContent,
            currentReferenceImageKeys: context.currentReferenceImageKeys,
            currentStagedImageArtifactKeys: context.currentStagedImageArtifactKeys,
            requestKey: fingerprint,
          });
          let finish = false;
          try { finish = context.onToolSucceeded?.(invocation.slug, invocation.arguments, result) === true; }
          catch (error) { console.error('agent successful-tool observation failed', { slug: invocation.slug, error }); }
          const status = successfulStatus(invocation.slug, invocation.arguments, result);
          observe({ stage: 'tool', outcome: 'succeeded', candidateCount: allowedNames.length, selectedToolCount: 1, durationMs: performance.now() - toolStartedAt });
          return { status, searchOutcome: invocation.slug === 'app.search' ? appSearchOutcome(invocation.arguments, result) : undefined, finish };
        } catch (error) {
          if (error instanceof SparkRepositoryError || error instanceof SparkRefundError) throw error;
          console.error('agent tool execution failed', { slug: invocation.slug, error });
          const status = agentToolStatusSchema.parse({ ...invocation, status: 'failed', error: safeFailure(error) });
          observe({ stage: 'tool', outcome: 'failed', candidateCount: allowedNames.length, selectedToolCount: 1, durationMs: performance.now() - toolStartedAt });
          return { status };
        }
      })();
      executions.set(fingerprint, promise);
      if (invocation.slug === 'app.generate-image') singleShotExecutions.set(invocation.slug, promise);
      return promise;
    };

    const outcomes = preparedCalls.length > 1
      ? await Promise.all(preparedCalls.map(executePrepared))
      : [await executePrepared(preparedCalls[0]!)];
    outcomes.forEach(({ status }, index) => {
      statuses.push(status);
      messages.push({ role: 'tool', content: [{ type: 'tool-result', toolCallId: preparedCalls[index]!.call.id, result: status }] });
    });
    if (turn === 0) messages.splice(0, currentRequestIndex);
    messages.push(currentRequestMessage(request, false));
    if (outcomes.some(({ finish }) => finish)) {
      emittedCalls = MAX_TOOL_CALLS;
      turn += 1;
      continue;
    }
    const searchOutcome = searchCalls.length ? outcomes[preparedCalls.indexOf(searchCalls[0]!)]!.searchOutcome : undefined;
    if (searchCalls.length) {
      if (searchRetry) { appSearchClosed = true; searchRetry = undefined; }
      else if (searchOutcome?.kind === 'empty') searchRetry = searchOutcome.retry;
      else if (searchOutcome?.kind === 'nonempty') appSearchClosed = true;
    }
    turn += 1;
  }
}

export { agentResponseSchema, internalAgentRequestSchema } from './schemas';
export type { AgentDefinition, AgentResponse, AgentToolStatus, InternalAgentRequest } from './schemas';
