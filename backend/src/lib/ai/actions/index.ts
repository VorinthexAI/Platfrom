import { ACTION_SLUGS, isValidActionIdFormat } from './types';

export { ACTION_SLUGS, actionIdSchema, type ActionId } from './types';
export {
  actionSchema,
  getActionById,
  getActionBySlug,
  insertAction,
  updateAction,
  deleteAction,
  type Action,
} from '@/lib/db/actions.node';

export function assertActionRegistryIntegrity(): void {
  if (new Set(ACTION_SLUGS).size !== ACTION_SLUGS.length) {
    throw new Error('ACTION_SLUGS contains duplicate action slugs');
  }
  for (const slug of ACTION_SLUGS) {
    if (!isValidActionIdFormat(slug)) {
      throw new Error(`Action slug does not follow lowercase dot notation: ${slug}`);
    }
  }
}
