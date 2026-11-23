// Scripts the mechanical steps of a release (docs/releasing.md). It never pushes a branch or the release tag without
// being asked, and it never merges:
//   node scripts/release.mjs prepare X.Y.Z   branch release/X.Y.Z, bump the version, changelog, commit (no push)
//   node scripts/release.mjs tag [--push]    tag origin/main as vX.Y.Z; --push also pushes the tag, which publishes
//   node scripts/release.mjs verify          compare npm and the GitHub Release with the version
import { execFileSync } from 'node:child_process';
import { readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const PACKAGE = 'packages/cli/package.json';
const CHANGELOG = 'CHANGELOG.md';
const USAGE = 'usage: node scripts/release.mjs prepare X.Y.Z | tag [--push] | verify';

const fail = (message) => {
  console.error(`adrien: ${message}`);
  process.exit(1);
};

/** On Windows, pnpm and npm are `.cmd` shims, which only a shell can start; git and gh are executables. */
export function needsShell(cmd, platform = process.platform) {
  return platform === 'win32' && (cmd === 'pnpm' || cmd === 'npm');
}

/** Runs a command and returns its trimmed stdout. Throws when it fails. Arguments are fixed words, never user text. */
export function run(cmd, args, options = {}) {
  // With stdio inherited there is no output to return, so the result is null.
  const shell = needsShell(cmd);
  return (
    execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], shell, ...options })?.trim() ?? ''
  );
}

const git = (...args) => run('git', args);

/** Returns [major, minor, patch] for a plain X.Y.Z version, or null for anything else (prereleases, `v` prefixes). */
export function parseVersion(version) {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version ?? '');
  return match ? match.slice(1).map(Number) : null;
}

/** True when version `a` is greater than `b`; both are plain X.Y.Z. */
export function isGreater(a, b) {
  const [x, y] = [parseVersion(a), parseVersion(b)];
  for (let i = 0; i < 3; i++) {
    if (x[i] !== y[i]) return x[i] > y[i];
  }
  return false;
}

/** The version a release is cut at: `prepare` checks the argument against it and `tag` reads it from the checkout. */
export function requireVersion(version) {
  if (!parseVersion(version)) fail(`"${version ?? ''}" is not a plain X.Y.Z version (no prerelease, no "v" prefix).`);
  return version;
}

/** True when a `## [X.Y.Z]` / `### X.Y.Z` heading for `version` is in the changelog text. */
export function hasChangelogEntry(text, version) {
  const heading = new RegExp(`^#{2,4}\\s+\\[?${version.replaceAll('.', '\\.')}\\]?(?:[(\\s]|$)`, 'm');
  return heading.test(text);
}

const versionOf = (text) => JSON.parse(text).version;

/** Fails unless the working tree has no changes at all, tracked or untracked. */
export function requireCleanTree() {
  if (git('status', '--porcelain') !== '') fail('The working tree is not clean. Commit or stash your changes first.');
}

/** Sets the top-level "version" string and nothing else, so the rest of the file stays byte-identical. */
export function bumpVersionText(text, version) {
  return text.replace(/("version"\s*:\s*")[^"]*(")/, `$1${version}$2`);
}

function prepare(args) {
  if (args.length !== 1) fail(USAGE);
  const next = requireVersion(args[0]);
  const current = versionOf(readFileSync(PACKAGE, 'utf8'));
  if (!parseVersion(current))
    fail(`The version in ${PACKAGE} is "${current}", not a plain X.Y.Z; set it by hand first.`);
  if (!isGreater(next, current)) fail(`${next} must be greater than ${current}, the version in ${PACKAGE}.`);
  requireCleanTree();

  git('fetch', 'origin');
  if (git('rev-parse', 'HEAD') !== git('rev-parse', 'origin/main')) {
    fail('HEAD is not origin/main. Switch to main and bring it up to date with origin before preparing a release.');
  }

  const branch = `release/${next}`;
  git('switch', '-c', branch);

  const original = readFileSync(PACKAGE, 'utf8');
  writeFileSync(PACKAGE, bumpVersionText(original, next));

  run('pnpm', ['changelog'], { stdio: 'inherit' });

  git('add', PACKAGE, CHANGELOG);
  git('commit', '-m', `chore(release): ${next}`);

  console.log(`Prepared ${branch} with the ${next} bump and its changelog section. Nothing is pushed.`);
  console.log('Still to do, in order:');
  console.log(`  1. Read and tidy the ${next} entry in ${CHANGELOG}; commit any edit.`);
  console.log(`  2. git push -u origin ${branch}`);
  console.log('  3. Open the pull request and wait for Codex approval and green checks.');
  console.log(
    '  4. Merge it only when Codex approved the exact head commit and the checks are green, pinned to that commit:',
  );
  console.log('     gh pr merge <number> --merge --match-head-commit <full sha>');
  console.log('  5. git switch main && git pull --ff-only origin main');
  console.log('  6. pnpm release tag, then git push origin vX.Y.Z to publish.');
  console.log('     (or pnpm release tag --push, which does both in one step)');
  console.log('  7. pnpm release verify');
}

function tag(args) {
  const push = args.length === 1 && args[0] === '--push';
  if (args.length > 0 && !push) fail(USAGE);
  const version = requireVersion(versionOf(readFileSync(PACKAGE, 'utf8')));
  requireCleanTree();

  git('fetch', 'origin');
  const onMain = versionOf(git('show', `origin/main:${PACKAGE}`));
  if (onMain !== version) {
    fail(`origin/main has version ${onMain}, not ${version}. Merge the release pull request before tagging.`);
  }
  if (!hasChangelogEntry(git('show', `origin/main:${CHANGELOG}`), version)) {
    fail(`origin/main:${CHANGELOG} has no entry for ${version}. Run "pnpm changelog" on the release branch first.`);
  }

  const tagName = `v${version}`;
  const local = git('tag', '--list', tagName);
  const remote = git('ls-remote', '--tags', 'origin', `refs/tags/${tagName}`);
  if (local !== '' || remote !== '') fail(`The tag ${tagName} already exists.`);

  git('tag', tagName, 'origin/main');
  if (push) {
    git('push', 'origin', tagName);
    console.log(`Pushed ${tagName}. The release workflow publishes it; check with pnpm release verify.`);
  } else {
    console.log(`Tagged origin/main as ${tagName}. Not pushed. Pushing publishes, so run this yourself:`);
    console.log(`  git push origin ${tagName}`);
  }
}

function verify(args) {
  if (args.length !== 0) fail(USAGE);
  const version = requireVersion(versionOf(readFileSync(PACKAGE, 'utf8')));
  let npmVersion = '';
  try {
    npmVersion = run('npm', ['view', 'adrien', 'version']);
  } catch (error) {
    console.error(`npm view failed: ${error.stderr?.toString().trim() ?? error.message}`);
  }
  console.log(`npm: ${npmVersion || '(none)'}`);
  let releaseFound = true;
  try {
    console.log(run('gh', ['release', 'view', `v${version}`, '--json', 'tagName,url']));
  } catch (error) {
    releaseFound = false;
    console.error(`gh release view failed: ${error.stderr?.toString().trim() ?? error.message}`);
  }
  if (npmVersion !== version)
    fail(
      `npm does not show ${version} yet: it can take a few minutes after the workflow succeeds, so run this again before assuming the publish failed.`,
    );
  // The workflow creates the GitHub Release in a job of its own, after npm: one can exist without the other.
  if (!releaseFound) fail(`npm shows ${version}, but there is no GitHub Release v${version}.`);
}

const commands = { prepare, tag, verify };

// Importing this file (the tests do) must not run a command. Both paths are resolved, because Node resolves symlinks for
// the module's own URL but not for argv, and a mismatch would run nothing and still exit 0.
if (process.argv[1] && realpathSync(fileURLToPath(import.meta.url)) === realpathSync(process.argv[1])) {
  const [command, ...args] = process.argv.slice(2);
  if (!Object.hasOwn(commands, command)) fail(USAGE);
  try {
    commands[command](args);
  } catch (error) {
    fail(error.stderr?.toString().trim() || error.message);
  }
}
