import { mkdirSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { CODE_CONFIG_FILE, CONFIG_FILE } from '../src/config.ts';
import { checkoutPaths, componentForPath, componentRoot, resolveContext } from '../src/context.ts';
import { configYaml, tmpDir, writeFiles } from './helpers/fixtures.ts';
import { git, initRepo } from './helpers/git.ts';

const BILLING_URL = 'https://gitlab.example.com/acme/billing-service.git';

function decisionsAndBilling() {
  const root = tmpDir();
  writeFiles(root, {
    [`decisions/${CONFIG_FILE}`]: configYaml(),
    [`billing/${CODE_CONFIG_FILE}`]: 'log: ../decisions\n',
    'billing/src/Invoices/Invoice.ts': 'export {};\n',
  });
  const billing = join(root, 'billing');
  initRepo(billing);
  git(billing, 'remote', 'add', 'origin', BILLING_URL);
  return { root, decisions: join(root, 'decisions'), billing };
}

function monorepo() {
  const root = tmpDir();
  writeFiles(root, {
    [CONFIG_FILE]: configYaml({
      components: { web: { repo: '.', root: 'apps/web' }, apps: { repo: '.', root: 'apps' } },
    }),
    'apps/web/src/a.ts': 'export {};\n',
  });
  initRepo(root);
  return root;
}

test('finds the log root walking up from a nested dir', async () => {
  const root = tmpDir();
  writeFiles(root, { [CONFIG_FILE]: configYaml() });
  const nested = join(root, 'docs', 'adr');
  mkdirSync(nested, { recursive: true });
  const ctx = await resolveContext({ cwd: nested, env: {} });
  expect(ctx).toMatchObject({ logRoot: root, readOnly: false, cwd: nested });
  expect(ctx.config.product).toBe('acme');
});

test('code repo: .adrien.yaml "../decisions" resolves from that file; components come from the origin URL', async () => {
  const { decisions, billing } = decisionsAndBilling();
  const ctx = await resolveContext({ cwd: join(billing, 'src'), env: {} });
  expect(ctx.logRoot).toBe(decisions);
  expect(ctx.codeRepo).toEqual({ root: billing, components: ['billing-service'] });
});

test('a URL log is cloned into ADRIEN_HOME/cache and is read-only', async () => {
  const decisions = tmpDir();
  writeFiles(decisions, { [CONFIG_FILE]: configYaml() });
  const { origin } = initRepo(decisions, { origin: true });
  const code = tmpDir();
  writeFiles(code, { [CODE_CONFIG_FILE]: `log: ${pathToFileURL(origin ?? '').href}\n` });
  const home = tmpDir();
  const ctx = await resolveContext({ cwd: code, env: { ADRIEN_HOME: home } });
  expect(ctx.readOnly).toBe(true);
  expect(ctx.logRoot.startsWith(join(home, 'cache'))).toBe(true);
  expect(ctx.config.product).toBe('acme');
});

test('monorepo: a component with repo "." is detected inside the log repo', async () => {
  const root = monorepo();
  const ctx = await resolveContext({ cwd: join(root, 'apps', 'web', 'src'), env: {} });
  expect(ctx.codeRepo?.root).toBe(root);
  expect(ctx.codeRepo?.components.sort()).toEqual(['apps', 'web']);
});

test('nothing configured → CONFIG_NOT_FOUND with the init hint', async () => {
  await expect(resolveContext({ cwd: tmpDir(), env: {} })).rejects.toMatchObject({
    code: 'CONFIG_NOT_FOUND',
    message: expect.stringContaining('adrien init --code-repo --log <path|url>'),
  });
});

test('componentForPath picks the longest root and accepts backslashes', async () => {
  const root = monorepo();
  const ctx = await resolveContext({ cwd: root, env: {} });
  expect(componentForPath(ctx, 'apps\\web\\src\\a.ts')).toEqual({ component: 'web', relPath: 'src/a.ts' });
  expect(componentForPath(ctx, 'apps/api/main.ts')).toEqual({ component: 'apps', relPath: 'api/main.ts' });
});

test('a path outside every component → null', async () => {
  const root = monorepo();
  const ctx = await resolveContext({ cwd: root, env: {} });
  expect(componentForPath(ctx, 'docs/readme.md')).toBeNull();
});

test('checkoutPaths keeps Windows drive letters and lets ADRIEN_REPOS override checkouts.yaml', () => {
  const home = tmpDir();
  writeFiles(home, { 'checkouts.yaml': 'components:\n  billing-service: /old\n  infra: /srv/infra\n' });
  expect(checkoutPaths({ ADRIEN_HOME: home, ADRIEN_REPOS: 'billing-service=/a;web=C:\\code\\web' })).toEqual({
    'billing-service': '/a',
    infra: '/srv/infra',
    web: 'C:\\code\\web',
  });
});

test('checkoutPaths skips ADRIEN_REPOS entries without a name before =', () => {
  expect(checkoutPaths({ ADRIEN_HOME: tmpDir(), ADRIEN_REPOS: ' ; web=/x; junk ;=/y' })).toEqual({ web: '/x' });
});

test('checkoutPaths still reads the old workspace.yaml when there is no checkouts.yaml', () => {
  const home = tmpDir();
  writeFiles(home, { 'workspace.yaml': 'components:\n  billing-service: /old\n' });
  expect(checkoutPaths({ ADRIEN_HOME: home })).toEqual({ 'billing-service': '/old' });
});

test('checkoutPaths reads checkouts.yaml and ignores workspace.yaml when both exist', () => {
  const home = tmpDir();
  writeFiles(home, {
    'checkouts.yaml': 'components:\n  billing-service: /new\n',
    'workspace.yaml': 'components:\n  billing-service: /old\n  infra: /old-infra\n',
  });
  expect(checkoutPaths({ ADRIEN_HOME: home })).toEqual({ 'billing-service': '/new' });
});

test('a component root with a leading dot keeps it', async () => {
  const root = tmpDir();
  writeFiles(root, {
    [CONFIG_FILE]: configYaml({ components: { ci: { repo: '.', root: '.github' }, dot: { repo: '.', root: './' } } }),
    '.github/workflows/ci.yml': 'on: push\n',
  });
  initRepo(root);
  const ctx = await resolveContext({ cwd: root, env: {} });
  expect(componentRoot(ctx.config, 'ci')).toBe('.github');
  expect(componentRoot(ctx.config, 'dot')).toBe('');
  expect(componentForPath(ctx, '.github/workflows/ci.yml')).toEqual({ component: 'ci', relPath: 'workflows/ci.yml' });
});

// Git reports physical paths, so a symlinked checkout (or, on Windows, an 8.3 short temp path) must be resolved the
// same way before node-side paths are compared with git's.
test.skipIf(process.platform === 'win32')('a symlinked working directory resolves to its real path', async () => {
  const root = monorepo();
  const link = join(tmpDir(), 'link');
  symlinkSync(root, link, 'dir');
  const ctx = await resolveContext({ cwd: join(link, 'apps', 'web'), env: {} });
  expect(ctx.cwd).toBe(join(root, 'apps', 'web'));
  expect(ctx.logRoot).toBe(root);
  expect(componentForPath(ctx, 'src/a.ts')).toEqual({ component: 'web', relPath: 'src/a.ts' });
});
