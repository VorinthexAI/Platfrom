import { z } from 'zod';
import { DOT_NOTATION_PATTERN } from '@/lib/ai/shared/ids';

/**
 * Every action the execution layer knows about, in lowercase dot
 * notation. Actions describe WHAT must be done — they are provider- and
 * model-independent. This constant is the single source of truth: the
 * `ActionId` type, the zod enum, and the registry integrity checks all
 * derive from it.
 */
export const ACTION_SLUGS = [
  'core.ask',
  'core.reason',
  'core.delegate',

  'agent.create',
  'artifact.create',
  'artifact.read',

  'organization.member.list',
  'organization.member.read',
  'organization.member.add',
  'organization.member.role.update',
  'organization.member.activate',
  'organization.member.suspend',
  'organization.member.remove',

  'scope.list',
  'scope.read',
  'scope.create',
  'scope.update',
  'scope.move',
  'scope.archive',
  'scope.restore',
  'scope.remove',

  'scope.member.list',
  'scope.member.read',
  'scope.member.add',
  'scope.member.role.update',
  'scope.member.activate',
  'scope.member.suspend',
  'scope.member.remove',

  'scope.agent.list',
  'scope.agent.read',
  'scope.agent.add',
  'scope.agent.move',
  'scope.agent.archive',
  'scope.agent.restore',
  'scope.agent.remove',
  'scope.agent.access-threshold.update',

  'agent.member.list',
  'agent.member.read',
  'agent.member.grant',
  'agent.member.revoke',
  'agent.member.sync',

  'organization.provider.list',
  'organization.provider.read',
  'organization.provider.enable',
  'organization.provider.disable',
  'organization.provider.test',

  'organization.read',
  'organization.update',
  'organization.archive',
  'organization.restore',

  'access.organization.evaluate',
  'access.scope.evaluate',
  'access.agent.evaluate',
  'access.organization.explain',
  'access.scope.explain',
  'access.agent.explain',

  'web.search',
  'web.deep-research',

  'image.generate',
  'image.edit',
  'image.create-slideshow',

  'video.generate',
  'video.edit',
  'video.extend',
  'video.analyze',
  'video.create-variation',

  'audio.transcribe',
  'audio.generate-speech',
  'audio.analyze',
  'audio.generate-music',
] as const;

export type ActionId = (typeof ACTION_SLUGS)[number];

export const actionIdSchema = z.enum(ACTION_SLUGS);

export function isValidActionIdFormat(id: string): boolean {
  return DOT_NOTATION_PATTERN.test(id);
}
