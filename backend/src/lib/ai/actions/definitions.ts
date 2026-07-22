import { ACTION_SLUGS, type ActionId } from './types';

export type ActionModelPolicy = 'required' | 'configurable' | 'none';
export interface ActionModelBinding { provider: string; model: string; priority: number }
export interface ActionDefinition { id: ActionId; modelPolicy: ActionModelPolicy; models: readonly ActionModelBinding[] }

const bedrock = 'aws-bedrock';
const model = (name: string, priority: number): ActionModelBinding => ({ provider: bedrock, model: name, priority });
const none = (): ActionDefinition => ({ id: '' as ActionId, modelPolicy: 'configurable', models: [] });

const definitions: Record<ActionId, ActionDefinition> = {
  ask: { id: 'ask', modelPolicy: 'required', models: [model('amazon.nova-2-lite', 100), model('amazon.nova-pro', 90), model('amazon.nova-premier', 80)] },
  chat: { id: 'chat', modelPolicy: 'required', models: [model('amazon.nova-pro', 100), model('amazon.nova-2-lite', 90), model('amazon.nova-premier', 80)] },
  'orchestrator-chat': { id: 'orchestrator-chat', modelPolicy: 'required', models: [model('amazon.nova-2-sonic', 100)] },
  reason: { id: 'reason', modelPolicy: 'required', models: [model('amazon.nova-pro', 100), model('amazon.nova-premier', 90), model('amazon.nova-2-lite', 80)] },
  'deep-reason': { id: 'deep-reason', modelPolicy: 'required', models: [model('amazon.nova-premier', 100), model('amazon.nova-pro', 90)] },
  embed: { id: 'embed', modelPolicy: 'required', models: [model('amazon.titan-embed-text-v2', 100)] },
  speak: { id: 'speak', modelPolicy: 'required', models: [model('amazon.nova-2-sonic', 100)] },
  transcribe: { id: 'transcribe', modelPolicy: 'required', models: [model('amazon.nova-2-sonic', 100)] },
  'web-search': { id: 'web-search', modelPolicy: 'required', models: [model('amazon.nova-2-lite', 100), model('amazon.nova-pro', 90)] },
  traverse: { id: 'traverse', modelPolicy: 'none', models: [] },
  read: { id: 'read', modelPolicy: 'none', models: [] },
  insert: { id: 'insert', modelPolicy: 'none', models: [] },
  upsert: { id: 'upsert', modelPolicy: 'none', models: [] },
  update: { id: 'update', modelPolicy: 'none', models: [] },
  delete: { id: 'delete', modelPolicy: 'none', models: [] },
  'generate-image': { ...none(), id: 'generate-image' },
  'edit-image': { ...none(), id: 'edit-image' },
  'generate-video': { ...none(), id: 'generate-video' },
  'edit-video': { ...none(), id: 'edit-video' },
  'extend-video': { ...none(), id: 'extend-video' },
  'analyze-video': { id: 'analyze-video', modelPolicy: 'required', models: [model('amazon.nova-pro', 100), model('amazon.nova-2-lite', 90), model('amazon.nova-premier', 80)] },
  'generate-speech': { id: 'generate-speech', modelPolicy: 'required', models: [{ provider: 'aws-polly', model: 'amazon.polly-generative', priority: 100 }] },
  'analyze-audio': { id: 'analyze-audio', modelPolicy: 'required', models: [model('amazon.nova-pro', 100), model('amazon.nova-2-lite', 90)] },
  'generate-music': { ...none(), id: 'generate-music' },
  'document-validate': { id: 'document-validate', modelPolicy: 'none', models: [] },
  'storage-upload': { id: 'storage-upload', modelPolicy: 'none', models: [] },
  'document-extract': { id: 'document-extract', modelPolicy: 'none', models: [] },
  'document-generate-html': { id: 'document-generate-html', modelPolicy: 'none', models: [] },
  'document-generate-json': { id: 'document-generate-json', modelPolicy: 'none', models: [] },
  'document-generate-content': { id: 'document-generate-content', modelPolicy: 'none', models: [] },
  'document-embed': { id: 'document-embed', modelPolicy: 'none', models: [] },
  'document-insert': { id: 'document-insert', modelPolicy: 'none', models: [] },
};

export const ACTION_DEFINITIONS: readonly ActionDefinition[] = ACTION_SLUGS.map((id) => definitions[id]);
export const getActionDefinition = (id: ActionId) => definitions[id];
