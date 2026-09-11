import { expect, test } from 'bun:test';
import { addFundingRequirementIndex } from './0003-funding-requirement-index';

test('indexes unacknowledged per-user funding requirements for reconnect replay', async () => {
  const indexes: unknown[] = [];
  await addFundingRequirementIndex({ collection: (name: string) => ({ ensureIndex: async (index: unknown) => { indexes.push({ name, index }); } }) } as never);
  expect(indexes).toEqual([{
    name: 'conversationMessages',
    index: { type: 'persistent', fields: ['userKey', 'fundingRequiredAcknowledgedAt', 'completedAt', '_key'] },
  }]);
});
