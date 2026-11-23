import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { CONFIG_FILE } from '../src/config.ts';
import { AdrienError } from '../src/errors.ts';
import { parseWorkspaceSpecs, resolveWorkspaces, workspaceSpecsFromEnv } from '../src/workspaces.ts';
import { configYaml, tmpDir, writeFiles } from './helpers/fixtures.ts';
import { initRepo } from './helpers/git.ts';

/** A path log whose adrien.config.yaml is `yaml`; returns its root. */
function pathLog(yaml: string): string {
  const root = tmpDir();
  writeFiles(root, { [CONFIG_FILE]: yaml });
  return root;
}

function thrownBy(fn: () => unknown): unknown {
  try {
    fn();
    return undefined;
  } catch (e) {
    return e;
  }
}

/** A log pushed to a bare origin, reached by its file:// URL; returns the URL and the isolated ADRIEN_HOME. */
function urlLog(yaml: string): { url: string; env: NodeJS.ProcessEnv } {
  const root = tmpDir();
  writeFiles(root, { [CONFIG_FILE]: yaml });
  const { origin } = initRepo(root, { origin: true });
  return { url: pathToFileURL(origin ?? '').href, env: { ADRIEN_HOME: tmpDir() } };
}

describe('parseWorkspaceSpecs', () => {
  test('name=log names an entry; a bare log is unnamed', () => {
    expect(parseWorkspaceSpecs(['acme=C:\\code\\log', 'other=/srv/log'])).toEqual([
      { name: 'acme', log: 'C:\\code\\log' },
      { name: 'other', log: '/srv/log' },
    ]);
    expect(parseWorkspaceSpecs(['/a/b'])).toEqual([{ log: '/a/b' }]);
  });

  test('a URL query string is not a name: ?ref=main stays part of the log', () => {
    expect(parseWorkspaceSpecs(['https://host/repo.git?ref=main'])).toEqual([
      { log: 'https://host/repo.git?ref=main' },
    ]);
    expect(parseWorkspaceSpecs(['acme=https://host/x.git?ref=main'])).toEqual([
      { name: 'acme', log: 'https://host/x.git?ref=main' },
    ]);
  });

  test('a Windows path and a path with = in a directory are unnamed logs', () => {
    expect(parseWorkspaceSpecs(['C:\\code\\log'])).toEqual([{ log: 'C:\\code\\log' }]);
    expect(parseWorkspaceSpecs(['/a/b=c'])).toEqual([{ log: '/a/b=c' }]);
  });

  test('an empty name before = makes the whole entry an unnamed log', () => {
    expect(parseWorkspaceSpecs(['=/a/b'])).toEqual([{ log: '=/a/b' }]);
  });

  test('a name that is not a valid workspace name leaves the entry unnamed', () => {
    expect(parseWorkspaceSpecs(['Bad Name=/a/b'])).toEqual([{ log: 'Bad Name=/a/b' }]);
  });

  test('a valid name with nothing after = is INVALID_INPUT', () => {
    expect(() => parseWorkspaceSpecs(['acme='])).toThrow(/Workspace "acme" has no log after "="/);
    expect(thrownBy(() => parseWorkspaceSpecs(['acme= ']))).toMatchObject({ code: 'INVALID_INPUT' });
  });

  test('trims everything and skips empty entries', () => {
    expect(parseWorkspaceSpecs(['  acme = /a/b  ', '', '   '])).toEqual([{ name: 'acme', log: '/a/b' }]);
  });
});

describe('workspaceSpecsFromEnv', () => {
  test('splits on ; and parses each entry', () => {
    expect(workspaceSpecsFromEnv('acme=/a; /b ;;')).toEqual([{ name: 'acme', log: '/a' }, { log: '/b' }]);
  });

  test('undefined gives no specs', () => {
    expect(workspaceSpecsFromEnv(undefined)).toEqual([]);
  });
});

describe('resolveWorkspaces', () => {
  test('one path log is named by its workspace field', async () => {
    const log = pathLog(configYaml({ product: 'Acme Billing', workspace: 'billing' }));
    const ws = await resolveWorkspaces({ cwd: tmpDir(), specs: [{ log }], env: {} });
    expect(ws.names()).toEqual(['billing']);
    expect(ws.only().ctx.logRoot).toBe(log);
  });

  test('without a workspace field the name is the product slug', async () => {
    const log = pathLog(configYaml({ product: 'Acme Billing' }));
    const ws = await resolveWorkspaces({ cwd: tmpDir(), specs: [{ log }], env: {} });
    expect(ws.names()).toEqual(['acme-billing']);
  });

  test('name= overrides the configured name', async () => {
    const log = pathLog(configYaml({ workspace: 'billing' }));
    const ws = await resolveWorkspaces({ cwd: tmpDir(), specs: [{ name: 'override', log }], env: {} });
    expect(ws.names()).toEqual(['override']);
  });

  test('two path logs give two workspaces', async () => {
    const a = pathLog(configYaml({ workspace: 'a' }));
    const b = pathLog(configYaml({ workspace: 'b' }));
    const ws = await resolveWorkspaces({ cwd: tmpDir(), specs: [{ log: a }, { log: b }], env: {} });
    expect(ws.names()).toEqual(['a', 'b']);
    expect(ws.all.map((w) => w.ctx.logRoot)).toEqual([a, b]);
  });

  test('a path log and a file:// git URL log together', async () => {
    const local = pathLog(configYaml({ workspace: 'local' }));
    const remote = urlLog(configYaml({ workspace: 'remote' }));
    const ws = await resolveWorkspaces({
      cwd: tmpDir(),
      specs: [{ log: local }, { log: remote.url }],
      env: remote.env,
    });
    expect(ws.names()).toEqual(['local', 'remote']);
    expect(ws.get('remote').ctx.readOnly).toBe(true);
  });

  test('empty specs discover the log from cwd as one workspace', async () => {
    const log = pathLog(configYaml({ workspace: 'found' }));
    const ws = await resolveWorkspaces({ cwd: join(log, 'docs'), specs: [], env: {} });
    expect(ws.names()).toEqual(['found']);
    expect(ws.only().ctx.logRoot).toBe(log);
  });

  test('an invalid given name is INVALID_INPUT', async () => {
    const log = pathLog(configYaml({ workspace: 'a' }));
    await expect(
      resolveWorkspaces({ cwd: tmpDir(), specs: [{ name: 'Bad Name', log }], env: {} }),
    ).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  });

  test('a single log whose product slugs to nothing is named "default", so it keeps working', async () => {
    const log = pathLog(configYaml({ product: '!!!' }));
    const ws = await resolveWorkspaces({ cwd: tmpDir(), specs: [{ log }], env: {} });
    expect(ws.names()).toEqual(['default']);
    expect(ws.only().name).toBe('default');
  });

  test('among several logs, one whose product slugs to nothing and has no name is INVALID_INPUT', async () => {
    const log = pathLog(configYaml({ product: '!!!' }));
    const other = pathLog(configYaml({ product: 'beta' }));
    const error = await resolveWorkspaces({ cwd: tmpDir(), specs: [{ log }, { log: other }], env: {} }).catch(
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(AdrienError);
    expect(error).toMatchObject({ code: 'INVALID_INPUT' });
    expect((error as Error).message).toBe(
      `The log at ${log} has no usable workspace name: set \`workspace\` in its adrien.config.yaml or pass name=<path>.`,
    );
  });

  test('two workspaces with the same name are CONFIG_INVALID', async () => {
    const a = pathLog(configYaml({ workspace: 'same' }));
    const b = pathLog(configYaml({ workspace: 'other' }));
    await expect(
      resolveWorkspaces({ cwd: tmpDir(), specs: [{ log: a }, { name: 'same', log: b }], env: {} }),
    ).rejects.toMatchObject({ code: 'CONFIG_INVALID' });
  });

  test('the same path log twice is CONFIG_INVALID', async () => {
    const log = pathLog(configYaml({ workspace: 'a' }));
    await expect(
      resolveWorkspaces({ cwd: tmpDir(), specs: [{ log }, { name: 'b', log }], env: {} }),
    ).rejects.toMatchObject({ code: 'CONFIG_INVALID' });
  });

  test('the same URL log in two spellings is CONFIG_INVALID', async () => {
    const remote = urlLog(configYaml({ workspace: 'remote' }));
    await expect(
      resolveWorkspaces({
        cwd: tmpDir(),
        specs: [{ log: remote.url }, { name: 'again', log: `${remote.url}/` }],
        env: remote.env,
      }),
    ).rejects.toMatchObject({ code: 'CONFIG_INVALID' });
  });
});

describe('Workspaces lookup', () => {
  async function two() {
    const a = pathLog(configYaml({ workspace: 'a' }));
    const b = pathLog(configYaml({ workspace: 'b' }));
    return resolveWorkspaces({ cwd: tmpDir(), specs: [{ log: a }, { log: b }], env: {} });
  }

  test('get returns the named workspace', async () => {
    const ws = await two();
    expect(ws.get('b').name).toBe('b');
  });

  test.each(['missing', '..', 'constructor', '__proto__', ''])('get(%j) is CONFIG_NOT_FOUND', async (name) => {
    const ws = await two();
    const error = thrownBy(() => ws.get(name));
    expect(error).toBeInstanceOf(AdrienError);
    expect(error).toMatchObject({ code: 'CONFIG_NOT_FOUND' });
    expect((error as Error).message).toBe(`No workspace "${name}". Known: a, b.`);
  });

  test('only() returns the single workspace', async () => {
    const log = pathLog(configYaml({ workspace: 'solo' }));
    const ws = await resolveWorkspaces({ cwd: tmpDir(), specs: [{ log }], env: {} });
    expect(ws.only().name).toBe('solo');
  });

  test('only() with several workspaces is CONFIG_NOT_FOUND', async () => {
    const ws = await two();
    const error = thrownBy(() => ws.only());
    expect(error).toBeInstanceOf(AdrienError);
    expect(error).toMatchObject({ code: 'CONFIG_NOT_FOUND' });
    expect((error as Error).message).toBe('This instance has several workspaces: name one of a, b.');
  });
});
