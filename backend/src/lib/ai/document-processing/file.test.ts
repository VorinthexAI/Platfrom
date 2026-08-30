import { expect, test } from 'bun:test';
import { createAwsFileAction } from './file';

test('dispatches document and scan inputs through the canonical AWS file executor', async () => {
  const calls: string[] = [];
  const action = createAwsFileAction(
    { extract: async (storageKey) => { calls.push(`document:${storageKey}`); return { extractedText: 'PDF text', metadata: { provider: 'aws-textract' } }; } },
    { extract: async (storageKey) => { calls.push(`scan:${storageKey}`); return { extractedText: 'Scan text', metadata: { averageConfidence: 99 } }; } },
  );
  const document = await action.execute({ operation: 'document', storageKey: 'content/report.pdf', filename: 'report.pdf', mimeType: 'application/pdf', bytes: new Uint8Array([1]) }, 'organization');
  const scan = await action.execute({ operation: 'scan', storageKey: 'content/page.png', mimeType: 'image/png', bytes: new Uint8Array([1]) }, 'organization');
  expect(calls).toEqual(['document:content/report.pdf', 'scan:content/page.png']);
  expect(document).toEqual({ text: 'PDF text', metadata: { provider: 'aws-textract' } });
  expect(scan).toEqual({ text: 'Scan text', metadata: { averageConfidence: 99 } });
});
