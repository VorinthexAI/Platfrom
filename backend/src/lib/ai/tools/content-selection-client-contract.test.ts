import { expect, test } from 'bun:test';

import { planContentSelectionCopy, planContentSelectionMove } from '../../../../../mobile/app/src/lib/content-selection-plans';
import { contentToolContracts } from './content-schemas';

const selection = {
  folderKeys: ['c123456789012345678901234'],
  documentKeys: ['c223456789012345678901234'],
};
const scopeKey = 'c323456789012345678901234';

for (const destination of [undefined, 'c423456789012345678901234']) {
  test(`mobile bulk copy and move inputs satisfy canonical strict contracts at ${destination ? 'a folder' : 'root'}`, () => {
    const plans = [
      planContentSelectionCopy(selection, scopeKey, [destination], 'copy-request'),
      planContentSelectionMove(selection, scopeKey, destination, 'move-request'),
    ];
    for (const plan of plans) {
      expect(plan.operationCount).toBe(2);
      for (const call of plan.calls) {
        const schema = contentToolContracts[call.tool].input;
        expect(schema.safeParse(call.input).success).toBe(true);
        expect(schema.safeParse({ ...call.input, unexpected: true }).success).toBe(false);
      }
    }
  });
}
