import ownership from '../deploy/ownership.json';

const changedFiles = process.argv.slice(2);
const affected = new Set<string>();
const githubOutput = process.env.GITHUB_OUTPUT;

for (const file of changedFiles) {
  let matched = false;
  for (const [prefix, roles] of Object.entries(ownership as Record<string, string[]>)) {
    if (file === prefix || file.startsWith(`${prefix}/`)) {
      roles.forEach((role) => affected.add(role));
      matched = true;
    }
  }
  if (!matched) {
    affected.add('app');
    affected.add('render');
  }
}

if (affected.size === 0) affected.add('app');
const roles = [...affected].sort();
console.log(roles.join(','));

if (githubOutput) {
  const fs = await import('node:fs/promises');
  await fs.appendFile(
    githubOutput,
    [
      `roles=${roles.join(',')}`,
      `app=${affected.has('app')}`,
      `render=${affected.has('render')}`,
      `any=${affected.size > 0}`,
      '',
    ].join('\n'),
  );
}

