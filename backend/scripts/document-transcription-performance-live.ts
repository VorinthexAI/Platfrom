import assert from 'node:assert/strict';
import sharp from 'sharp';
import { transcribeDocument, type DocumentTranscriptionSource } from '../src/lib/ai/actions/document-transcription';
import { executeAction } from '../src/lib/ai/router';
import { calculateActionCostMicroSparks, MICRO_SPARKS_PER_SPARK } from '../src/lib/costs';
import { liveOcrFixtures } from './lib/live-ocr-fixtures';

const args = process.argv.slice(2);
const option = (name: string) => args.find((value) => value.startsWith(`--${name}=`))?.slice(name.length + 3);
assert(args.every((value) => /^--(?:samples|filter|output)=/.test(value)), 'Usage: --samples=1 --filter=pdf-text --output=existing-directory/report.json');
const samples = Number(option('samples') ?? 1);
assert(Number.isInteger(samples) && samples >= 1 && samples <= 5);
const fixtures = liveOcrFixtures().filter(({ name }) => !option('filter') || name.includes(option('filter')!));
assert(fixtures.length > 0);
const reports = [];
for (const fixture of fixtures) {
  const original = await fixture.build();
  assert(original.length <= 25 * 1024 ** 2);
  for (let iteration = 1; iteration <= samples; iteration += 1) {
    const start = performance.now();
    const source: DocumentTranscriptionSource = fixture.kind === 'pdf'
      ? { type: 'file', filename: `${fixture.name}.pdf`, mimeType: 'application/pdf', bytes: original }
      : { type: 'image', mimeType: 'image/png', bytes: new Uint8Array(await sharp(original).rotate().png().toBuffer()) };
    const preparationMs = performance.now() - start;
    let usage = { inputTokens: 0, outputTokens: 0, totalTokens: 0 };
    const modelStart = performance.now();
    const result = await transcribeDocument(source, { teamKey: 'document-transcription-benchmark' }, {
      execute: (async (request, input, options) => { const response = await executeAction(request, input, options); usage = response.usage; return response; }) as typeof executeAction,
    });
    const finished = performance.now();
    const normalized = result.text.toLowerCase().replace(/\s+/g, ' ');
    const verifiedPages = Array.from({ length: fixture.pages }, (_, index) => new RegExp(`silver observatory page ${index + 1}\\b`).test(normalized)).filter(Boolean).length;
    assert.equal(verifiedPages, fixture.pages, `${fixture.name}: missing page headings in transcription`);
    const verifiedRecords = result.text.match(/\brecord\s+\d+\b/gi)?.length ?? 0;
    assert.equal(verifiedRecords, fixture.pages * (fixture.name.startsWith('pdf-text') ? 28 : 14), `${fixture.name}: missing or duplicated source records`);
    const row = { case: fixture.name, iteration, inputBytes: original.length, pages: fixture.pages, preparationMs, transcriptionMs: finished - modelStart, totalMs: finished - start, characters: result.text.length, ...usage, actionSparks: calculateActionCostMicroSparks('text', usage) / MICRO_SPARKS_PER_SPARK, verifiedPages, verifiedRecords };
    reports.push(row);
    console.log(JSON.stringify(row));
    if (option('output')) await Bun.write(option('output')!, `${JSON.stringify({ mode: 'real-model-transcription', generatedAt: new Date().toISOString(), fixedToolSparks: 0, reports }, null, 2)}\n`);
  }
}
console.table(reports.map((row) => ({ case: row.case, run: row.iteration, MiB: (row.inputBytes / 1024 ** 2).toFixed(3), pages: row.pages, seconds: (row.totalMs / 1000).toFixed(2), inputTokens: row.inputTokens, outputTokens: row.outputTokens, actionSparks: row.actionSparks })));
console.log('PASS: complete model transcription and source page headings verified. Durations include full output generation and provider file preprocessing; no Textract calls or fixed tool charges.');
