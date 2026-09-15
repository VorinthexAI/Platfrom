import { runDocumentBenchmarks } from './lib/document-ingestion-benchmark';

const args = process.argv.slice(2);
const value = (name: string) => args.find((arg) => arg.startsWith(`--${name}=`))?.slice(name.length + 3);
if (args.some((arg) => !/^--(?:samples|warmups|filter|output)=/.test(arg) && arg !== '--json')) throw new Error('Usage: --samples=5 --warmups=1 --filter=pdf --json --output=existing-directory/report.json');
const report = await runDocumentBenchmarks({ samples: Number(value('samples') ?? 5), warmups: Number(value('warmups') ?? 1), filter: value('filter') });
if (value('output')) await Bun.write(value('output')!, `${JSON.stringify(report, null, 2)}\n`);
if (args.includes('--json')) console.log(JSON.stringify(report, null, 2));
else {
  console.log(`Mocked ingestion benchmark: ${report.rows.length} cases, ${report.measuredSamples} samples/case, ${report.warmups} warmup(s). Bun ${report.runtime}, ${report.platform}/${report.architecture}.`);
  console.log('Durations measure local processing with mocked services, not AWS/model latency. DOC/DOCX/PDF fixtures use synthetic containers and mocked extraction.');
  console.table(report.rows.map((row) => ({ case: row.name, MiB: (row.inputBytes / 1024 ** 2).toFixed(3), textChars: row.extractedCharacters, chunks: row.chunks, status: row.status, medianMs: row.durations.medianMs.toFixed(2), p95Ms: row.durations.p95Ms.toFixed(2), maxMs: row.durations.maxMs.toFixed(2) })));
  for (const row of report.rows.filter(({ status }) => status === 'rejected')) console.log(`${row.name}: ${row.error}`);
  if (value('output')) console.log(`Full report with stage timings and raw samples: ${value('output')}`);
}
