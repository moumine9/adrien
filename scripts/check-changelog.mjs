// Fails when the published package's version has no entry in CHANGELOG.md, so a version bump cannot be merged or
// released without saying what changed. It looks at the version as it is now, so it needs no base branch: after a
// release the version already has its entry, and a bump without one fails here.
import { readFileSync } from 'node:fs';

const fail = (message) => {
  console.error(`adrien: ${message}`);
  process.exit(1);
};

const { version } = JSON.parse(readFileSync('packages/cli/package.json', 'utf8'));

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

// The entry runs to the next version heading (or any level 2 heading), and must say something. The generator writes
// patch releases as `### [x.y.z]` with `### Bug Fixes` under them, so the level alone cannot end an entry.
const versionHeading = /^#{2,4}\s+\[?\d+\.\d+\.\d+/;
const body = [];
for (const line of lines.slice(start + 1)) {
  if (versionHeading.test(line) || /^##\s/.test(line)) break;
  body.push(line);
}
if (!body.some((line) => line.trim() !== '')) {
  fail(`The CHANGELOG.md entry for version ${version} is empty.`);
}
