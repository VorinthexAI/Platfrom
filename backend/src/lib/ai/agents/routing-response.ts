export const DEFAULT_ROUTING_RESPONSE_MAX_BYTES = 128_000;
export const MAX_ROUTING_RESPONSE_TOOLS = 20;

export type RoutingResponse = { tools: string[]; message: string; name?: string };
export type RoutingResponseDecoderOptions = { allowedTools: ReadonlySet<string> | readonly string[]; emit: (fragment: string) => void | Promise<void>; name?: 'optional' | 'required'; maxBytes?: number };

export class RoutingResponseError extends Error {
  constructor(message: string) { super(`Invalid routing response: ${message}`); this.name = 'RoutingResponseError'; }
}

type StringToken = { complete: boolean; value: string; next: number };
type ParseSnapshot = { complete: boolean; message: string; messageComplete: boolean; toolsClosedEmpty: boolean; nameValid: boolean; value?: RoutingResponse };
const whitespace = (character: string | undefined) => character === ' ' || character === '\n' || character === '\r' || character === '\t';
const highSurrogate = (character: string) => { const code = character.charCodeAt(0); return code >= 0xd800 && code <= 0xdbff; };
function skipWhitespace(source: string, start: number) { let index = start; while (whitespace(source[index])) index += 1; return index; }

function parseString(source: string, start: number): StringToken {
  if (source[start] !== '"') throw new RoutingResponseError('expected a JSON string');
  let index = start + 1; let value = '';
  while (index < source.length) {
    const character = source[index]!;
    if (character === '"') return { complete: true, value, next: index + 1 };
    if (character.charCodeAt(0) < 0x20) throw new RoutingResponseError('unescaped control character in string');
    if (character !== '\\') { value += character; index += 1; continue; }
    index += 1;
    if (index >= source.length) return { complete: false, value, next: source.length };
    const escape = source[index]!;
    const simpleEscapes: Record<string, string> = { '"': '"', '\\': '\\', '/': '/', b: '\b', f: '\f', n: '\n', r: '\r', t: '\t' };
    if (escape in simpleEscapes) { value += simpleEscapes[escape]; index += 1; continue; }
    if (escape !== 'u') throw new RoutingResponseError(`invalid JSON escape \\${escape}`);
    const available = source.slice(index + 1, Math.min(index + 5, source.length));
    if (!/^[0-9a-fA-F]*$/.test(available)) throw new RoutingResponseError('invalid unicode escape');
    if (available.length < 4) return { complete: false, value, next: source.length };
    value += String.fromCharCode(Number.parseInt(available, 16)); index += 5;
  }
  return { complete: false, value, next: source.length };
}

function parseTools(source: string, start: number, allowedTools: ReadonlySet<string>) {
  if (source[start] !== '[') throw new RoutingResponseError('tools must be an array');
  const tools: string[] = []; const selected = new Set<string>(); let index = skipWhitespace(source, start + 1);
  if (index >= source.length) return { complete: false, tools, next: index };
  if (source[index] === ']') return { complete: true, tools, next: index + 1 };
  while (true) {
    if (source[index] !== '"') throw new RoutingResponseError('tools must contain only strings');
    const token = parseString(source, index);
    if (!token.complete) return { complete: false, tools, next: token.next };
    if (!allowedTools.has(token.value)) throw new RoutingResponseError(`tool "${token.value}" is not allowed`);
    if (selected.has(token.value)) throw new RoutingResponseError(`duplicate tool "${token.value}"`);
    selected.add(token.value); tools.push(token.value);
    if (tools.length > MAX_ROUTING_RESPONSE_TOOLS) throw new RoutingResponseError(`tools may contain at most ${MAX_ROUTING_RESPONSE_TOOLS} entries`);
    index = skipWhitespace(source, token.next);
    if (index >= source.length) return { complete: false, tools, next: index };
    if (source[index] === ']') return { complete: true, tools, next: index + 1 };
    if (source[index] !== ',') throw new RoutingResponseError('expected a comma or closing bracket in tools');
    index = skipWhitespace(source, index + 1);
    if (index >= source.length) return { complete: false, tools, next: index };
    if (source[index] === ']') throw new RoutingResponseError('trailing comma in tools');
  }
}

function parseResponse(source: string, allowedTools: ReadonlySet<string>, nameMode: 'optional' | 'required'): ParseSnapshot {
  let index = skipWhitespace(source, 0); const snapshot: ParseSnapshot = { complete: false, message: '', messageComplete: false, toolsClosedEmpty: false, nameValid: false };
  if (index >= source.length) return snapshot;
  if (source[index] !== '{') throw new RoutingResponseError('expected an object');
  index = skipWhitespace(source, index + 1);
  const fields = new Set<string>(); let tools: string[] | undefined; let message: string | undefined; let name: string | undefined; let first = true;
  while (true) {
    if (index >= source.length) return snapshot;
    if (source[index] === '}') { if (!first) throw new RoutingResponseError('trailing comma in object'); index += 1; break; }
    if (source[index] !== '"') throw new RoutingResponseError('expected a property name');
    const keyToken = parseString(source, index); if (!keyToken.complete) return snapshot;
    const key = keyToken.value;
    if (key !== 'tools' && key !== 'message' && key !== 'name') throw new RoutingResponseError(`unknown field "${key}"`);
    if (fields.has(key)) throw new RoutingResponseError(`duplicate field "${key}"`); fields.add(key);
    index = skipWhitespace(source, keyToken.next); if (index >= source.length) return snapshot;
    if (source[index] !== ':') throw new RoutingResponseError(`expected a colon after "${key}"`);
    index = skipWhitespace(source, index + 1); if (index >= source.length) return snapshot;
    if (key === 'tools') {
      const token = parseTools(source, index, allowedTools); if (!token.complete) return snapshot;
      tools = token.tools; snapshot.toolsClosedEmpty = tools.length === 0; index = token.next;
    } else {
      if (source[index] !== '"') throw new RoutingResponseError(`${key} must be a string`);
      const token = parseString(source, index);
      if (key === 'message') { snapshot.message = token.value; snapshot.messageComplete = token.complete; }
      if (!token.complete) return snapshot;
      if (key === 'message') message = token.value;
      else {
        name = token.value;
        if (!name.trim()) throw new RoutingResponseError('name must not be blank');
        if (name.length > 200) throw new RoutingResponseError('name must contain at most 200 characters');
        snapshot.nameValid = true;
      }
      index = token.next;
    }
    index = skipWhitespace(source, index); if (index >= source.length) return snapshot;
    if (source[index] === '}') { index += 1; break; }
    if (source[index] !== ',') throw new RoutingResponseError('expected a comma or closing brace');
    index = skipWhitespace(source, index + 1); first = false;
  }
  index = skipWhitespace(source, index);
  if (index !== source.length) throw new RoutingResponseError('trailing content after object');
  if (tools === undefined) throw new RoutingResponseError('missing tools field');
  if (message === undefined) throw new RoutingResponseError('missing message field');
  if (nameMode === 'required' && name === undefined) throw new RoutingResponseError('missing name field');
  if (name !== undefined && name.trim() === '') throw new RoutingResponseError('name must not be blank');
  if (name !== undefined && name.length > 200) throw new RoutingResponseError('name must contain at most 200 characters');
  if (message.length > 100_000) throw new RoutingResponseError('message must contain at most 100000 characters');
  if (tools.length === 0 && message.trim() === '') throw new RoutingResponseError('direct response message must not be blank');
  if (tools.length > 0 && message !== '') throw new RoutingResponseError('tool-selection response message must be exactly empty');
  const value: RoutingResponse = name === undefined ? { tools, message } : { tools, message, name };
  return { complete: true, message, messageComplete: true, toolsClosedEmpty: tools.length === 0, nameValid: snapshot.nameValid, value };
}

export function createRoutingResponseDecoder(options: RoutingResponseDecoderOptions) {
  const allowedTools = options.allowedTools instanceof Set ? options.allowedTools : new Set(options.allowedTools);
  const maxBytes = options.maxBytes ?? DEFAULT_ROUTING_RESPONSE_MAX_BYTES;
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) throw new TypeError('maxBytes must be a positive safe integer');
  let source = ''; let emittedLength = 0; let result: RoutingResponse | undefined; let terminalError: unknown; let finished = false;
  const inspect = async () => {
    let snapshot: ParseSnapshot;
    try { snapshot = parseResponse(source, allowedTools, options.name ?? 'optional'); } catch (error) { terminalError = error; throw error; }
    if (snapshot.complete) result = snapshot.value;
    if (!snapshot.toolsClosedEmpty) return;
    if ((options.name ?? 'optional') === 'required' && !snapshot.nameValid) return;
    let safeMessage = snapshot.message;
    if (safeMessage.length > 100_000) throw new RoutingResponseError('message must contain at most 100000 characters');
    if (!snapshot.messageComplete && safeMessage.length > 0 && highSurrogate(safeMessage.at(-1)!)) safeMessage = safeMessage.slice(0, -1);
    if (safeMessage.length > emittedLength) { const fragment = safeMessage.slice(emittedLength); emittedLength = safeMessage.length; await options.emit(fragment); }
  };
  return {
    async push(fragment: string) {
      if (terminalError) throw terminalError; if (finished) throw new RoutingResponseError('cannot push after finish');
      if (typeof fragment !== 'string') throw new TypeError('routing response fragment must be a string');
      source += fragment;
      if (new TextEncoder().encode(source).byteLength > maxBytes) { terminalError = new RoutingResponseError(`response exceeds ${maxBytes} bytes`); throw terminalError; }
      await inspect();
    },
    async finish() {
      if (terminalError) throw terminalError;
      if (finished) { if (result) return result; throw new RoutingResponseError('response is incomplete'); }
      finished = true; await inspect();
      if (!result) { terminalError = new RoutingResponseError('response is truncated or incomplete'); throw terminalError; }
      return result;
    },
  };
}
