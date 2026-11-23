import { spawnSync } from 'node:child_process';
import { chmodSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { delimiter, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { needsShell } from '../../../scripts/release.mjs';
import { tmpDir, writeFiles } from '../../core/test/helpers/fixtures.ts';
import { commitAll, git, gitEnv, initRepo } from '../../core/test/helpers/git.ts';

const script = fileURLToPath(new URL('../../../scripts/release.mjs', import.meta.url));

const packageJson = (version: string) =>
  `${JSON.stringify({ name: 'adrien', version, description: 'a thing', license: 'AGPL-3.0-only' }, null, 2)}\n`;
const changelogEntry = (version: string) =>
  `## [${version}](https://example.com/compare) (2026-11-01)\n\n### Features\n\n* a thing\n`;

/** A repository whose origin/main is at `version` with a changelog entry for it, checked out at that commit. */
function repo(version = '0.1.0') {
  const root = tmpDir();
  writeFiles(root, {
    'packages/cli/package.json': packageJson(version),
    'CHANGELOG.md': changelogEntry(version),
  });
  const { origin } = initRepo(root, { origin: true });
  return { root, origin: origin as string };
}

/** Pushes a commit with `files` to origin/main from a fresh clone. */
function publish(origin: string, files: Record<string, string>): void {
  const clone = tmpDir();
  git(clone, 'clone', '-q', origin, '.');
  writeFiles(clone, files);
  commitAll(clone, 'release');
  git(clone, 'push', '-q', 'origin', 'main');
}

/** A `pnpm` on PATH that does what `pnpm changelog` does to CHANGELOG.md for `version`: appends a heading. */
function fakePnpm(version: string): string {
  const bin = tmpDir();
  const pnpm = join(bin, 'pnpm');
  writeFileSync(
    pnpm,
    `#!/bin/sh\nprintf '\\n## [${version}](https://example.com) (2026-11-23)\\n\\n### Features\\n\\n* a thing\\n' >> CHANGELOG.md\n`,
  );
  chmodSync(pnpm, 0o755);
  return bin;
}

function release(root: string, args: string[], path?: string) {
  const env = path ? { ...gitEnv(), PATH: `${path}${delimiter}${process.env.PATH}` } : gitEnv();
  const run = spawnSync(process.execPath, [script, ...args], { cwd: root, encoding: 'utf8', env });
  return { code: run.status, stdout: run.stdout, stderr: run.stderr };
}

const remoteTags = (origin: string) => git(origin, 'tag', '--list');

describe('release prepare', () => {
  test('says so, instead of a TypeError, when the version in the checkout is itself a prerelease', () => {
    const { root } = repo('0.2.0-rc.1');
    const result = release(root, ['prepare', '0.2.0']);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain('0.2.0-rc.1');
    expect(result.stderr).not.toContain('TypeError');
  });

  test('refuses a version that is not plain semver', () => {
    for (const version of ['0.2', '0.2.0-rc.1', 'v0.2.0', '0.2.x', '']) {
      const { root } = repo();
      const result = release(root, ['prepare', version]);
      expect(result.code, version).toBe(1);
      expect(result.stderr, version).toMatch(/^adrien: /);
      expect(git(root, 'branch', '--list', 'release/*'), version).toBe('');
    }
  });

  test('refuses a version that is not greater than the current one', () => {
    for (const version of ['0.1.0', '0.0.9']) {
      const { root } = repo();
      const result = release(root, ['prepare', version]);
      expect(result.code).toBe(1);
      expect(result.stderr).toContain('greater than 0.1.0');
    }
  });

  test('refuses a dirty working tree', () => {
    const { root } = repo();
    writeFileSync(join(root, 'CHANGELOG.md'), `${changelogEntry('0.1.0')}\nedited\n`);
    const result = release(root, ['prepare', '0.2.0']);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain('not clean');
    expect(git(root, 'branch', '--list', 'release/*')).toBe('');
  });

  test('refuses when HEAD is behind origin/main', () => {
    const { root, origin } = repo();
    publish(origin, { 'README.md': 'ahead\n' });
    const result = release(root, ['prepare', '0.2.0']);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain('origin/main');
    expect(git(root, 'branch', '--list', 'release/*')).toBe('');
  });

  // The fake pnpm is a POSIX shell script, which Windows cannot run without a shell; the other tests are portable.
  test.skipIf(process.platform === 'win32')(
    'on a clean repo, creates the branch, bumps only the version and commits it without pushing',
    () => {
      const { root, origin } = repo();
      const before = readFileSync(join(root, 'packages/cli/package.json'), 'utf8');

      const result = release(root, ['prepare', '0.2.0'], fakePnpm('0.2.0'));

      expect(result.code).toBe(0);
      expect(git(root, 'branch', '--show-current')).toBe('release/0.2.0');
      expect(git(root, 'log', '-1', '--format=%s')).toBe('chore(release): 0.2.0');
      expect(git(root, 'show', '--name-only', '--format=', 'HEAD').split('\n').sort()).toEqual([
        'CHANGELOG.md',
        'packages/cli/package.json',
      ]);
      expect(readFileSync(join(root, 'packages/cli/package.json'), 'utf8')).toBe(
        before.replace('"version": "0.1.0"', '"version": "0.2.0"'),
      );
      expect(readFileSync(join(root, 'CHANGELOG.md'), 'utf8')).toContain('## [0.2.0]');
      expect(git(origin, 'branch', '--list', 'release/*')).toBe('');
      expect(result.stdout).toContain('pnpm release tag');
    },
  );
});

describe('release tag', () => {
  /** A repository where origin/main is at `version` with its changelog entry, and the checkout is in step with it. */
  function released(version: string) {
    const { root, origin } = repo();
    publish(origin, {
      'packages/cli/package.json': packageJson(version),
      'CHANGELOG.md': `${changelogEntry(version)}\n${changelogEntry('0.1.0')}`,
    });
    git(root, 'pull', '-q', '--ff-only', 'origin', 'main');
    return { root, origin };
  }

  test('refuses a version that origin/main does not have', () => {
    const { root } = repo();
    writeFiles(root, { 'packages/cli/package.json': packageJson('0.2.0') });
    commitAll(root, 'bump');
    const result = release(root, ['tag']);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain('origin/main');
    expect(git(root, 'tag', '--list')).toBe('');
  });

  test('refuses a version whose changelog entry is missing on origin/main', () => {
    const { root, origin } = repo();
    publish(origin, { 'packages/cli/package.json': packageJson('0.2.0') });
    git(root, 'pull', '-q', '--ff-only', 'origin', 'main');
    const result = release(root, ['tag']);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain('CHANGELOG.md');
    expect(git(root, 'tag', '--list')).toBe('');
  });

  test('refuses a tag that already exists locally', () => {
    const { root } = released('0.2.0');
    git(root, 'tag', 'v0.2.0', 'origin/main');
    const result = release(root, ['tag']);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain('v0.2.0 already exists');
  });

  test('refuses a tag that already exists on origin', () => {
    const { root, origin } = released('0.2.0');
    git(root, 'tag', 'v0.2.0', 'origin/main');
    git(root, 'push', '-q', 'origin', 'v0.2.0');
    git(root, 'tag', '-d', 'v0.2.0');
    const result = release(root, ['tag']);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain('v0.2.0 already exists');
    expect(remoteTags(origin)).toBe('v0.2.0');
  });

  test('creates the tag on origin/main and prints the push command without pushing', () => {
    const { root, origin } = released('0.2.0');
    const result = release(root, ['tag']);
    expect(result.code).toBe(0);
    expect(git(root, 'rev-parse', 'v0.2.0^{commit}')).toBe(git(root, 'rev-parse', 'origin/main'));
    expect(result.stdout).toContain('git push origin v0.2.0');
    expect(remoteTags(origin)).toBe('');
  });

  test('--push pushes the tag to origin', () => {
    const { root, origin } = released('0.2.0');
    const result = release(root, ['tag', '--push']);
    expect(result.code).toBe(0);
    expect(remoteTags(origin)).toBe('v0.2.0');
  });
});

describe('release arguments', () => {
  test.skipIf(process.platform === 'win32')(
    'run through a symlink, an unknown subcommand still fails with the usage',
    () => {
      const link = join(tmpDir(), 'release.mjs');
      symlinkSync(script, link);
      const run = spawnSync(process.execPath, [link, 'ship'], { encoding: 'utf8', env: gitEnv() });
      expect(run.status).toBe(1);
      expect(run.stderr).toContain('usage');
    },
  );

  test('an unknown subcommand prints the usage and fails', () => {
    const { root } = repo();
    const result = release(root, ['ship']);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain('usage');
  });

  test('verify takes no arguments', () => {
    const { root } = repo();
    const result = release(root, ['verify', '0.1.0']);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain('usage');
  });
});

/** A directory with fake `npm` and `gh` executables on PATH: npm prints `npmVersion`, gh exits with `ghCode`. */
function fakeRegistry(npmVersion: string, ghCode: number): string {
  const bin = tmpDir();
  for (const [name, body] of [
    ['npm', `echo ${npmVersion}`],
    ['gh', ghCode === 0 ? 'echo \'{"tagName":"v0.1.0"}\'' : `echo "release not found" >&2; exit ${ghCode}`],
  ] as const) {
    writeFileSync(join(bin, name), `#!/bin/sh\n${body}\n`);
    chmodSync(join(bin, name), 0o755);
  }
  return bin;
}

describe('release verify', () => {
  test.skipIf(process.platform === 'win32')('succeeds when npm shows the version and the GitHub Release exists', () => {
    const { root } = repo('0.1.0');
    expect(release(root, ['verify'], fakeRegistry('0.1.0', 0)).code).toBe(0);
  });

  test.skipIf(process.platform === 'win32')(
    'fails when npm shows the version but the GitHub Release is missing',
    () => {
      const { root } = repo('0.1.0');
      const result = release(root, ['verify'], fakeRegistry('0.1.0', 1));
      expect(result.code).toBe(1);
      expect(result.stderr).toContain('GitHub Release');
    },
  );

  test.skipIf(process.platform === 'win32')('fails, saying npm can lag, when npm still shows the old version', () => {
    const { root } = repo('0.2.0');
    const result = release(root, ['verify'], fakeRegistry('0.1.0', 0));
    expect(result.code).toBe(1);
    expect(result.stderr).toContain('a few minutes');
  });
});

describe('needsShell', () => {
  test('only the Windows shims of pnpm and npm need a shell', () => {
    expect(needsShell('pnpm', 'win32')).toBe(true);
    expect(needsShell('npm', 'win32')).toBe(true);
    expect(needsShell('git', 'win32')).toBe(false);
    expect(needsShell('gh', 'win32')).toBe(false);
    expect(needsShell('pnpm', 'linux')).toBe(false);
    expect(needsShell('npm', 'darwin')).toBe(false);
  });
});
