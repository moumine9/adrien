// Prints the CHANGELOG.md entry for one version, without its heading, as the notes of the GitHub Release:
//   node scripts/release-notes.mjs 0.4.0 > release-notes.md
// It reads the headings as scripts/check-changelog.mjs does, and fails when the entry is missing or empty, so a release
// never gets blank notes.
import { readFileSync } from 'node:fs';

const fail = (message) => {
  console.error(`adrien: ${message}`);
  process.exit(1);
};

const version = process.argv[2];
if (!version) fail('usage: node scripts/release-notes.mjs <version>');

let text;
try {
  text = readFileSync('CHANGELOG.md', 'utf8');
} catch {
  fail('CHANGELOG.md is missing. Run "pnpm changelog" on the release branch and commit the result.');
}

// `## [0.4.0](…) (date)` as the generator writes it, or `### 0.3.1` as the hand-written history does.
const heading = new RegExp(`^(#{2,4})\\s+\\[?${version.replaceAll('.', '\\.')}\\]?(?:[(\\s]|$)`);
const lines = text.split(/\r?\n/);
const start = lines.findIndex((line) => heading.test(line));
if (start === -1) {
  fail(
    `CHANGELOG.md has no entry for version ${version}. Run "pnpm changelog" on the release branch and commit the result.`,
  );
}

// The entry runs to the next version heading (or any level 2 heading). Patch releases are `### [x.y.z]` with
// `### Bug Fixes` under them, so the level alone cannot end an entry.
const versionHeading = /^#{2,4}\s+\[?\d+\.\d+\.\d+/;
const body = [];
for (const line of lines.slice(start + 1)) {
  if (versionHeading.test(line) || /^##\s/.test(line)) break;
  body.push(line);
}

const notes = body.join('\n').trim();
if (notes === '') fail(`The CHANGELOG.md entry for version ${version} is empty.`);
process.stdout.write(`${notes}\n`);
