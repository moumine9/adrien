// Adds a section for the next release to CHANGELOG.md, from the Conventional Commits since the last v* tag.
// Run it on the release branch after bumping packages/cli/package.json, then commit the result:
//   pnpm changelog            writes the section at the top of CHANGELOG.md
//   pnpm changelog --stdout   prints it instead
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const { version } = JSON.parse(readFileSync('packages/cli/package.json', 'utf8'));

// The CLI reads the version of the closest package.json, which is the private workspace root and has none.
const context = join(mkdtempSync(join(tmpdir(), 'adrien-changelog-')), 'context.json');
writeFileSync(context, JSON.stringify({ version }));

const result = spawnSync(
  process.execPath,
  [
    'node_modules/conventional-changelog/dist/cli/index.js',
    '-p',
    'conventionalcommits',
    '-c',
    context,
    '-r',
    '1',
    '-i',
    'CHANGELOG.md',
    ...process.argv.slice(2),
  ],
  { stdio: 'inherit' },
);
process.exit(result.status ?? 1);
