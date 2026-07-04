import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { writeFile } from 'node:fs/promises';
import { chooseEnvironment, closeProdSshTunnel, loadEnvironment, verifyProdDatabaseConnection } from './lib/environment';
import { selectMenu } from './lib/menu';

const rl = createInterface({ input, output });

const ALL_NODES = '__all_nodes__';
type NodeSelection = string | typeof ALL_NODES;

async function countNode(accessor: { getAllChunked: (chunkSize?: number) => AsyncGenerator<unknown[], void, void> }) {
  let count = 0;
  for await (const chunk of accessor.getAllChunked()) count += chunk.length;
  return count;
}

async function chooseNode(
  names: string[],
  counts: Record<string, number>,
): Promise<NodeSelection> {
  const totalCount = Object.values(counts).reduce((sum, count) => sum + count, 0);
  const selected = await selectMenu<NodeSelection>(`Nodes - total ${totalCount}`, [
    { label: `all nodes (${totalCount})`, value: ALL_NODES },
    ...names.map((name) => ({ label: `${name} (${counts[name] ?? 0})`, value: name })),
  ]);
  if (!selected) throw new Error('No node selected.');
  return selected;
}

async function chooseAction(): Promise<'print' | 'export'> {
  const selected = await selectMenu<'print' | 'export'>('Node output', [
    { label: 'print', value: 'print', hint: 'dump JSON to the terminal' },
    { label: 'export', value: 'export', hint: 'save JSON to a file in the project root' },
  ]);
  if (!selected) throw new Error('No output action selected.');
  return selected;
}

function scrubNodeForOutput(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(scrubNodeForOutput);
  if (!value || typeof value !== 'object') return value;

  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => key !== 'embedding')
      .map(([key, nestedValue]) => [key, scrubNodeForOutput(nestedValue)]),
  );
}

async function fetchNodeItems(
  registry: Record<string, { getAllChunked: (chunkSize?: number) => AsyncGenerator<unknown[], void, void> }>,
  nodeName: string,
) {
  const items: unknown[] = [];
  for await (const chunk of registry[nodeName]!.getAllChunked()) {
    items.push(...chunk);
  }
  return items;
}

/** yyyy-mm-dd_hh-mm-ss — colons aren't valid in Windows filenames, so this is the closest safe stand-in. */
function timestampForFilename(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
  ].join('-') + '_' + [
    pad(date.getHours()),
    pad(date.getMinutes()),
    pad(date.getSeconds()),
  ].join('-');
}

async function main() {
  const environment = await chooseEnvironment(rl);
  rl.pause();
  loadEnvironment(environment);
  if (environment === 'prod') await verifyProdDatabaseConnection();

  try {
    // Imported after env vars are loaded, since this transitively opens the Arango connection.
    const { NODE_REGISTRY, NODE_NAMES } = await import('@/lib/db/registry');

    console.log('\nCounting node records...');
    const counts = Object.fromEntries(await Promise.all(
      NODE_NAMES.map(async (name) => [name, await countNode(NODE_REGISTRY[name]!)] as const),
    ));

    const nodeName = await chooseNode(NODE_NAMES, counts);
    const action = await chooseAction();

    console.log(`\nFetching ${nodeName === ALL_NODES ? 'all node' : `"${nodeName}"`} records from ${environment}...`);
    const items = nodeName === ALL_NODES
      ? Object.fromEntries(await Promise.all(
        NODE_NAMES.map(async (name) => [name, await fetchNodeItems(NODE_REGISTRY, name)] as const),
      ))
      : await fetchNodeItems(NODE_REGISTRY, nodeName);
    const itemCount = nodeName === ALL_NODES
      ? Object.values(counts).reduce((sum, count) => sum + count, 0)
      : counts[nodeName] ?? 0;
    if (nodeName === ALL_NODES) {
      for (const name of NODE_NAMES) console.log(`${name}: ${counts[name] ?? 0}`);
    }
    console.log(`Fetched ${itemCount} record${itemCount === 1 ? '' : 's'}.`);

    const json = JSON.stringify(scrubNodeForOutput(items), null, 2);

    if (action === 'print') {
      console.log(`\n${json}`);
      return;
    }

    const filename = `${timestampForFilename(new Date())}.${nodeName === ALL_NODES ? 'all-nodes' : nodeName}.json`;
    await writeFile(filename, json, 'utf8');
    console.log(`\nSaved ${itemCount} record${itemCount === 1 ? '' : 's'} to ${filename}`);
  } finally {
    const { closeDb } = await import('@/lib/db/client');
    await closeDb();
    closeProdSshTunnel();
    rl.close();
  }
}

await main();
